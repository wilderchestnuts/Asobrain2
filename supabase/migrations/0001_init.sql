-- Asobrain2 initial schema.
--
-- The server is authoritative: `games.state` is only ever written by the
-- service role from /api routes. Browsers get RLS-gated SELECT so Realtime can
-- push them version bumps, and nothing else.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'game_status') then
    create type public.game_status as enum ('lobby', 'active', 'finished');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Player',
  created_at timestamptz not null default now()
);

-- A profile row must exist by the time the user first hits the app, and doing
-- it in a trigger means no API route has to remember to create one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Player'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------------

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users (id) on delete set null,
  -- Guest games (no Supabase Auth user) are keyed to a browser-stored id.
  created_by_guest text,
  status public.game_status not null default 'lobby',
  options jsonb not null default '{}'::jsonb,
  state jsonb,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists games_created_by_idx on public.games (created_by);
create index if not exists games_status_idx on public.games (status);
create index if not exists games_updated_at_idx on public.games (updated_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists games_touch_updated_at on public.games;
create trigger games_touch_updated_at
  before update on public.games
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- game_players
-- ---------------------------------------------------------------------------

create table if not exists public.game_players (
  game_id uuid not null references public.games (id) on delete cascade,
  seat integer not null,
  -- The engine's PlayerId. Stable for the life of the game.
  player_id text not null,
  user_id uuid references auth.users (id) on delete set null,
  -- Set instead of user_id when the seat is held by a signed-out guest.
  guest_id text,
  name text not null,
  color text not null,
  is_bot boolean not null default false,
  bot_difficulty text,
  joined_at timestamptz not null default now(),
  primary key (game_id, seat),
  unique (game_id, player_id)
);

create index if not exists game_players_user_id_idx on public.game_players (user_id);
create index if not exists game_players_guest_id_idx on public.game_players (guest_id);

-- ---------------------------------------------------------------------------
-- game_actions — append-only log
-- ---------------------------------------------------------------------------

-- Every applied action, in order. With `options.seed` this replays a game
-- exactly, which is the only practical way to debug a rules bug after the fact.
create table if not exists public.game_actions (
  id bigserial primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  seat integer,
  action jsonb not null,
  -- The games.version this action produced.
  applied_version integer not null,
  created_at timestamptz not null default now()
);

create index if not exists game_actions_game_id_idx
  on public.game_actions (game_id, id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so the games policy can consult game_players without
-- triggering that table's own policies (which would recurse).
create or replace function public.is_game_participant(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.game_players gp
    where gp.game_id = p_game_id
      and gp.user_id = auth.uid()
  );
$$;

create or replace function public.is_public_lobby(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.games g
    where g.id = p_game_id
      and g.status = 'lobby'
      and coalesce((g.options ->> 'isPublic')::boolean, false)
  );
$$;

alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.game_actions enable row level security;

-- profiles: display names are visible to any signed-in player (you need to see
-- who you are sitting across from); a user may only edit their own row.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

-- games: readable by participants, the creator, and anyone browsing an open
-- lobby. There is deliberately no INSERT/UPDATE/DELETE policy — every write
-- goes through an API route using the service role, which bypasses RLS.
drop policy if exists games_select on public.games;
create policy games_select on public.games
  for select to authenticated
  using (
    created_by = auth.uid()
    or public.is_game_participant(id)
    or (status = 'lobby' and coalesce((options ->> 'isPublic')::boolean, false))
  );

drop policy if exists game_players_select on public.game_players;
create policy game_players_select on public.game_players
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_game_participant(game_id)
    or public.is_public_lobby(game_id)
  );

drop policy if exists game_actions_select on public.game_actions;
create policy game_actions_select on public.game_actions
  for select to authenticated
  using (public.is_game_participant(game_id));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

-- Only the bookkeeping columns are published. `state` holds every player's
-- hand, so shipping it down the Realtime socket would hand opponents the
-- hidden information that redactFor() exists to strip. Clients learn that
-- `version` changed and then refetch their own redacted view over HTTP.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime with (publish = 'insert,update,delete');
  end if;

  if exists (
    select 1 from pg_publication
    where pubname = 'supabase_realtime' and puballtables
  ) then
    raise notice 'supabase_realtime publishes all tables; games.state will be broadcast. Consider recreating the publication.';
  elsif not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'games'
  ) then
    alter publication supabase_realtime
      add table public.games (id, version, status, updated_at);
  end if;
end $$;

-- postgres_changes replays the row through RLS, so this must be REPLICA
-- IDENTITY DEFAULT (primary key) at minimum for UPDATE payloads to carry an id.
alter table public.games replica identity default;
