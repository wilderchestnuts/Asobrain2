# Deploying Asobrain2

This guide assumes you have never used Supabase or Vercel. Follow it top to
bottom and you will end up with a game two people can play from two different
devices.

There are two ways to run the app:

| Mode | What you need | What you get |
| --- | --- | --- |
| **Local mode** | Nothing. `npm run dev`. | One device, no accounts. Games are stored in a `.asobrain/local-games.json` file in the project folder. |
| **Full mode** | A free Supabase project + Vercel. | Two people on two devices, magic-link sign-in, games saved in Postgres. |

Start with local mode to check the app works. Everything below is about moving
to full mode.

---

## 0. Local mode first (2 minutes)

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. You are automatically a "guest": the browser is
given a long-lived cookie (`asobrain_guest`) that owns your seat. No env vars,
no Supabase, no sign-in. Games live in `.asobrain/local-games.json`, which is
fine for one machine and is not shared with anybody.

When you want the real thing, keep going.

---

## 1. Create a Supabase project

1. Go to <https://supabase.com> and sign up (GitHub login is quickest).
2. Click **New project**.
3. Fill in:
   - **Name**: `asobrain2` (anything you like).
   - **Database password**: click *Generate*, then save it in your password
     manager. You will not need it for this app, but you cannot see it again.
   - **Region**: pick the one closest to where you both live. This is the
     single biggest factor in how snappy the game feels.
4. Click **Create new project** and wait ~2 minutes for it to finish setting up.

---

## 2. Run the migration

The migration creates the tables, the security policies, and turns on Realtime.

1. In the Supabase dashboard, open **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open `supabase/migrations/0001_init.sql` from this repository, copy the
   **entire** file, and paste it into the editor.
4. Click **Run** (or press Cmd/Ctrl + Enter).
5. You should see `Success. No rows returned`. If you see an error, read it —
   the most common cause is running the file twice with a half-finished first
   run; the script is safe to re-run.

To check it worked: open **Table Editor** in the sidebar. You should see four
tables — `profiles`, `games`, `game_players`, `game_actions` — each with a
green **RLS enabled** badge.

> **Optional, if you have the Supabase CLI installed**
> ```bash
> supabase link --project-ref <your-project-ref>
> supabase db push
> ```
> This does the same thing from the terminal.

---

## 3. Turn on email sign-in

Magic links are on by default, but confirm the settings:

1. Go to **Authentication → Sign In / Providers**.
2. Make sure **Email** is enabled.
3. Turn **Confirm email** ON and leave **Enable email password** OFF — this app
   never asks for a password. Nobody wants to type one on an iPad.

Supabase's built-in email service is rate-limited (a handful of emails per
hour), which is plenty for two people. If you ever hit the limit, configure
your own SMTP under **Authentication → Emails → SMTP Settings**.

---

## 4. Collect your environment variables

In the Supabase dashboard go to **Project Settings → API keys** (and
**Project Settings → Data API** for the URL). You need three values:

| Variable | Where it comes from | Secret? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → Data API → **Project URL**. Looks like `https://abcdefghijklm.supabase.co`. | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API Keys → **anon / publishable** key. Starts with `sb_publishable_`, or is a long `eyJ...` JWT on older projects. | No — it is protected by Row Level Security |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API Keys → **service_role / secret** key. Click *Reveal*. Starts with `sb_secret_`, or is a long `eyJ...` JWT. | **YES. Treat it like a password.** |

Plus one of your own:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | The address the app is served from, with no trailing slash. `http://localhost:3000` locally; `https://your-app.vercel.app` in production. On Vercel you may omit it — the deployment URL is detected. |

### About the service-role key

It bypasses every security policy in the database. In this app it is used only
inside `/api/**` route handlers, which run on the server. It must **never**:

- be renamed to start with `NEXT_PUBLIC_`,
- be imported from a component that runs in the browser,
- be committed to git (`.env*` is already in `.gitignore`).

If you ever paste it somewhere public, go to **Project Settings → API Keys** and
rotate it immediately.

### Locally

```bash
cp .env.example .env.local
```

Fill in the four values, then restart `npm run dev`. Env vars are read at
startup — a running dev server will not pick them up.

---

## 5. Deploy to Vercel

1. Push this repository to GitHub.
2. Go to <https://vercel.com>, sign in with GitHub, and click **Add New →
   Project**.
3. Pick the repository. Vercel detects Next.js on its own; do not change the
   build settings.
4. Before clicking Deploy, expand **Environment Variables** and add all four:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SITE_URL` — you will not know the final URL yet. Leave it out
     for now and add it in step 6.
   Add each to **all** environments (Production, Preview, Development).
5. Click **Deploy** and wait.
6. Copy the URL Vercel gives you (e.g. `https://asobrain2.vercel.app`), then go
   to **Settings → Environment Variables**, add `NEXT_PUBLIC_SITE_URL` with
   that value, and **redeploy** (Deployments → ⋯ → Redeploy). Env vars are
   baked in at build time.

---

## 6. Configure the magic-link redirect URL

This is the step everyone forgets. Without it, clicking the link in the email
lands on the wrong site and sign-in silently fails.

1. Supabase dashboard → **Authentication → URL Configuration**.
2. **Site URL**: your production address, e.g. `https://asobrain2.vercel.app`.
3. **Redirect URLs**: click *Add URL* for each of these:
   - `https://asobrain2.vercel.app/auth/callback`
   - `http://localhost:3000/auth/callback` — so sign-in works while developing
   - `https://*-yourname.vercel.app/auth/callback` — optional, lets Vercel
     preview deployments sign in too
4. Save.

The app always sends people to `/auth/callback`, which exchanges the link for a
session cookie and then redirects to wherever they were headed.

---

## 7. Check it works

**Start here: open `https://your-app.vercel.app/api/health`.**

It reports, in plain language, whether each variable is set and well-formed and
whether the database is reachable with the tables in place. Almost every
deployment problem shows up here in one line — a URL pasted from the dashboard
instead of the API settings page, the publishable key in the secret slot, or a
migration that was never run. Fix whatever it flags and redeploy before going
further.

If every check passes but a game still will not start, add `?deep=1`:

```
https://your-app.vercel.app/api/health?deep=1
```

That saves a throwaway game, a seat and an action, then deletes them — the same
writes "Start game" performs. It is the only check that catches a column
mismatch or a row-level-security rule, because reading a table proves it exists
but not that it can be written to.

Then:

1. Open your deployed URL on the iPad. Enter an email, tap **Send link**.
2. Open the email on the same device and tap the link. It should return to the
   app signed in. (Opening the link on a *different* device than the one that
   requested it will fail — that is the PKCE security check doing its job.)
3. Create a game with one open human seat, and send the game URL to the other
   player.
4. They open it, sign in, and take the free seat.
5. Play a turn. The other device should update within a second or two.

If the other device does not update, it is not broken — it will still catch up
within four seconds, because the app polls as a fallback whenever the websocket
is down (which is constantly on iOS, whenever Safari backgrounds a tab). If it
never updates, see below.

---

## Troubleshooting

**Always check `/api/health` first.** It names the broken thing directly.

**"Invalid path specified in request URL"**
`NEXT_PUBLIC_SUPABASE_URL` had a service path on the end, usually
`https://<ref>.supabase.co/rest/v1`. The SDK appends `rest/v1` itself, so every
request went to `.../rest/v1/rest/v1/...`. The app strips these suffixes now, so
it works either way, but the variable should be the bare project URL:
`https://<ref>.supabase.co` with nothing after `.co`.

**"The string did not match the expected pattern" (Safari)**
This is Safari failing to parse an error page as JSON — the real failure is
underneath it. It used to mean a malformed `NEXT_PUBLIC_SUPABASE_URL`, which
made every request fail. The app now survives that and reports it properly, so
if you still see it, `/api/health` will say why.

**"The database is reachable but the tables are missing"**
The project exists but the schema was never applied. Run
`supabase/migrations/0001_init.sql` in the Supabase SQL editor (step 2). This is
easy to miss after recreating a Supabase project.

**"This deployment has no database"**
`SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) is missing from the
Vercel project. Without it the server cannot write games at all.

**"Supabase is not configured on this deployment"**
The env vars did not make it into the build. Check the spelling, check they are
enabled for the Production environment, and redeploy — changing an env var does
not rebuild by itself.

**Sign-in email never arrives**
Check spam. Then check **Authentication → Logs** in Supabase. The built-in
mailer is rate-limited to a few messages per hour.

**Clicking the magic link logs you out / shows "auth=error"**
The redirect URL is not in the allow-list (step 6), or `NEXT_PUBLIC_SITE_URL`
does not exactly match the address you are browsing (`http` vs `https`, or a
trailing slash).

**Other devices never see moves**
1. Check **Database → Publications** in Supabase: `supabase_realtime` must
   include the `games` table.
2. Confirm the players are actually in `game_players` for that game — Realtime
   applies the same Row Level Security rules as a normal query, so a
   non-participant is told nothing.

**"conflict" when taking an action**
Two moves landed at once and the second was rejected on purpose. The app
refetches and you can try again. Seeing it constantly means two browser tabs
are driving the same seat.

**Games disappear after a restart in local mode**
Local mode stores games in `.asobrain/local-games.json` next to the project. If
that folder is read-only (or you are running local mode on a serverless host,
which you should not), games only live in memory for as long as the process
does.

---

## What is stored where

| Table | Holds |
| --- | --- |
| `profiles` | Display name for each signed-in user. Created automatically on first sign-in. |
| `games` | One row per game: options, the full `state` JSON, and a `version` counter. |
| `game_players` | Who sits in which seat, and which seats are bots. |
| `game_actions` | Every action ever applied, in order. Combined with the game's seed this replays a whole game exactly, which is how a rules bug gets diagnosed after the fact. |

The `state` column is the authoritative game. Only the server writes it, and
only after the rules engine has approved the move. Clients receive a redacted
copy with other players' hands stripped out — Realtime deliberately publishes
only `id, version, status, updated_at` so the raw state never crosses the wire.
