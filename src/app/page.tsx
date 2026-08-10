'use client';

/**
 * Lobby.
 *
 * "Easy to join and just play" was the thing the owners most wanted to keep
 * from the game this replaces, so the default path is one tap: the New game
 * button comes pre-filled with a sensible setup and everything else is optional.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { BoardPreview } from '@/components/board/BoardPreview';
import { Button, TAP, panel } from '@/components/game/parts';
import {
  createGame,
  deleteGame,
  fetchMe,
  listMyGames,
  type GameListItem,
  type Me,
} from '@/hooks/useGame';
import { SCENARIOS } from '@/game/scenarios';
import { VICTORY_POINT_RANGE, defaultVictoryPoints } from '@/game/setup';
import { surface } from '@/lib/theme';

export default function LobbyPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [games, setGames] = useState<GameListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [seafarers, setSeafarers] = useState(true);
  const [citiesAndKnights, setCitiesAndKnights] = useState(true);
  const [scenario, setScenario] = useState('fog-islands');
  const [bots, setBots] = useState(1);
  const [vp, setVp] = useState<number | null>(null);
  /** Solo games skip the second human seat and start immediately. */
  const [solo, setSolo] = useState(false);

  const refresh = useCallback(async () => {
    setMe(await fetchMe());
    setGames(await listMyGames());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const target = vp ?? defaultVictoryPoints({ seafarers, citiesAndKnights });
  // A solo game needs at least one opponent, since two seats is the minimum.
  const soloBots = solo ? Math.max(1, bots) : bots;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const view = await createGame({
        options: {
          expansions: { seafarers, citiesAndKnights },
          scenario: seafarers ? scenario : 'classic',
          victoryPointsToWin: target,
          goldHexCount: seafarers ? 2 : 1,
          seed: Math.random().toString(36).slice(2, 10),
        },
        seats: [
          { kind: 'me' as const },
          // A solo game has no seat to wait for, so it starts straight away —
          // which is what makes it useful for trying things out.
          ...(solo ? [] : [{ kind: 'human' as const, name: 'Player 2' }]),
          ...Array.from({ length: soloBots }, (_, i) => ({
            kind: 'bot' as const,
            name: `Bot ${i + 1}`,
          })),
        ],
      });
      window.location.href = `/play/${view.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not create the game');
      setBusy(false);
    }
  };

  return (
    <main
      style={{
        minHeight: '100dvh',
        background: surface('board-bg'),
        color: surface('chrome-ink'),
        padding: `max(20px, env(safe-area-inset-top)) 20px 40px`,
      }}
    >
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 30, fontWeight: 700 }}>Asobrain2</h1>
          <p style={{ opacity: 0.75 }}>
            Catan with Seafarers and Cities &amp; Knights.
            {me && ` Signed in as ${me.displayName}.`}
          </p>
          {me && !me.persistent && (
            <p style={{ opacity: 0.7, fontSize: 13, marginTop: 6 }}>
              Running without a database — games live on this server only. See
              docs/DEPLOYMENT.md to connect Supabase.
            </p>
          )}
        </header>

        <section
          style={{
            ...panel,
            border: `1px solid ${surface('chrome-edge')}`,
            borderRadius: 16,
            padding: 18,
            marginBottom: 26,
          }}
        >
          <h2 style={{ fontSize: 19, fontWeight: 600, marginBottom: 14 }}>
            New game
          </h2>

          <Row label="Players">
            <Button
              tone={solo ? 'default' : 'primary'}
              onClick={() => setSolo(false)}
            >
              Two of us
            </Button>
            <Button
              tone={solo ? 'primary' : 'default'}
              onClick={() => setSolo(true)}
            >
              Just me vs bots
            </Button>
          </Row>

          <Row label="Expansions">
            <Toggle on={seafarers} onChange={setSeafarers} label="Seafarers" />
            <Toggle
              on={citiesAndKnights}
              onChange={setCitiesAndKnights}
              label="Cities &amp; Knights"
            />
          </Row>

          {seafarers && (
            <MapPicker chosen={scenario} onChoose={setScenario} />
          )}

          <Row label="Computer players">
            {(solo ? [1, 2, 3] : [0, 1, 2, 3]).map((n) => (
              <Button
                key={n}
                tone={soloBots === n ? 'primary' : 'default'}
                onClick={() => setBots(n)}
              >
                {n}
              </Button>
            ))}
          </Row>

          <Row label="Play to">
            <Button
              onClick={() => setVp(Math.max(VICTORY_POINT_RANGE.min, target - 1))}
            >
              −
            </Button>
            <strong style={{ minWidth: 56, textAlign: 'center', fontSize: 19 }}>
              {target}
            </strong>
            <Button
              onClick={() => setVp(Math.min(VICTORY_POINT_RANGE.max, target + 1))}
            >
              +
            </Button>
            {vp !== null && (
              <Button tone="ghost" onClick={() => setVp(null)}>
                default
              </Button>
            )}
          </Row>

          {error && (
            <div
              style={{
                marginBottom: 12,
                padding: 12,
                borderRadius: 10,
                border: '1px solid #B4232A',
                background: 'rgba(180,35,42,.08)',
              }}
            >
              <p style={{ color: '#B4232A', marginBottom: 8 }}>{error}</p>
              {/* A failure here is nearly always deployment config, so point
                  straight at the thing that can say which part. */}
              <a
                href="/api/health"
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: 'underline', fontSize: 14 }}
              >
                Open the configuration check →
              </a>
            </div>
          )}

          <Button tone="primary" wide disabled={busy} onClick={() => void start()}>
            {busy ? 'Starting…' : 'Start game'}
          </Button>
          <p style={{ fontSize: 13, opacity: 0.7, marginTop: 10 }}>
            {solo
              ? 'Starts straight away — no one to wait for.'
              : 'You get a link to send to your second player. They tap it and take a seat — no setup on their end.'}
          </p>
        </section>

        <section>
          <h2 style={{ fontSize: 19, fontWeight: 600, marginBottom: 12 }}>
            Your games
          </h2>
          {games.length === 0 ? (
            <p style={{ opacity: 0.7 }}>Nothing yet.</p>
          ) : (
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {games.map((g) => (
                <GameRow
                  key={g.id}
                  game={g}
                  onDelete={async () => {
                    await deleteGame(g.id);
                    setGames((prev) => prev.filter((x) => x.id !== g.id));
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

/**
 * One game in the list, with swipe-to-delete.
 *
 * Dragging left reveals the delete action, which then asks before doing
 * anything — a swipe is easy to trigger by accident while scrolling, and a
 * deleted game is not coming back. A plain button is always there too, since
 * swiping is invisible until you already know about it.
 */
function GameRow({
  game,
  onDelete,
}: {
  game: GameListItem;
  onDelete: () => Promise<void>;
}) {
  const [offset, setOffset] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; from: number } | null>(null);

  const REVEAL = 96;

  const label =
    game.status === 'finished'
      ? 'finished'
      : game.currentPlayerName
        ? `${game.currentPlayerName} to move`
        : game.status;

  return (
    <li>
      {/*
        Only the swipe area clips. Putting overflow:hidden on the whole row
        also clipped the confirmation panel below it, leaving a prompt that
        could be seen but not tapped.
      */}
      <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 12 }}>
      {/* The action sitting behind the row, revealed by the swipe. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          paddingRight: 12,
          background: '#B4232A',
          borderRadius: 12,
        }}
      >
        <button
          type="button"
          onClick={() => setConfirming(true)}
          style={{
            minHeight: TAP,
            padding: '0 16px',
            color: '#fff',
            fontWeight: 600,
            fontSize: 15,
          }}
        >
          Delete
        </button>
      </div>

      <div
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, from: offset };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const next = Math.min(0, Math.max(-REVEAL, d.from + (e.clientX - d.x)));
          setOffset(next);
        }}
        onPointerUp={() => {
          drag.current = null;
          // Snap to whichever end is nearer, so the row is never left ajar.
          setOffset((o) => (o < -REVEAL / 2 ? -REVEAL : 0));
        }}
        onPointerCancel={() => {
          drag.current = null;
          setOffset(0);
        }}
        style={{
          ...panel,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          minHeight: TAP + 14,
          padding: '10px 16px',
          border: `1px solid ${surface('chrome-edge')}`,
          borderRadius: 12,
          transform: `translateX(${offset}px)`,
          transition: drag.current ? 'none' : 'transform .18s ease',
          touchAction: 'pan-y',
          // Must sit above the delete panel revealed behind it, or the row's
          // own controls become unclickable.
          zIndex: 1,
        }}
      >
        <a
          href={`/play/${game.id}`}
          // A swipe must not also open the game.
          onClick={(e) => {
            if (offset !== 0) e.preventDefault();
          }}
          style={{ flex: 1, minWidth: 0, color: 'inherit' }}
        >
          <span style={{ fontWeight: 600 }}>
            {game.seats.map((s) => s.name).join(', ')}
          </span>
        </a>
        <span style={{ opacity: 0.75, fontSize: 14 }}>{label}</span>
        <button
          type="button"
          aria-label="Delete this game"
          onClick={() => setConfirming(true)}
          style={{
            minHeight: TAP,
            minWidth: TAP,
            fontSize: 18,
            opacity: 0.55,
          }}
        >
          ×
        </button>
      </div>
      </div>

      {confirming && (
        <div
          style={{
            ...panel,
            marginTop: 8,
            padding: 12,
            border: `1px solid #B4232A`,
            borderRadius: 12,
          }}
        >
          <p style={{ marginBottom: 10, fontSize: 15 }}>
            Delete this game for good?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              tone="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onDelete();
                } finally {
                  setBusy(false);
                  setConfirming(false);
                  setOffset(0);
                }
              }}
            >
              {busy ? 'Deleting…' : 'Delete'}
            </Button>
            <Button
              onClick={() => {
                setConfirming(false);
                setOffset(0);
              }}
            >
              Keep it
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Pick a map by looking at it.
 *
 * This was a dropdown, which asked you to choose between "The Long Chain" and
 * "Six Islands" on the strength of the names alone — and since the presets all
 * used to be a blob of land in a sea border, the names were the only thing
 * telling them apart. Each card carries the layout it will actually deal.
 */
function MapPicker({
  chosen,
  onChoose,
}: {
  chosen: string;
  onChoose: (id: string) => void;
}) {
  const maps = Object.entries(SCENARIOS).filter(([id]) => id !== 'classic');
  const detail = SCENARIOS[chosen];

  return (
    <div style={{ marginBottom: 14 }}>
      <span
        style={{ display: 'block', fontSize: 15, opacity: 0.85, marginBottom: 8 }}
      >
        Map
      </span>

      {/* A horizontal rail rather than a grid: it stays one row on a phone,
          and the overflow itself hints there is more to the right. */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          overflowX: 'auto',
          paddingBottom: 6,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {maps.map(([id, s]) => {
          const active = id === chosen;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChoose(id)}
              aria-pressed={active}
              style={{
                flex: '0 0 auto',
                width: 148,
                padding: 8,
                borderRadius: 14,
                textAlign: 'left',
                cursor: 'pointer',
                background: surface('chrome'),
                border: `2px solid ${
                  active ? surface('highlight-ring') : surface('chrome-edge')
                }`,
              }}
            >
              <BoardPreview scenarioId={id} width={132} height={104} />
              <strong
                style={{
                  display: 'block',
                  fontSize: 14,
                  marginTop: 6,
                  lineHeight: 1.25,
                }}
              >
                {s.name}
              </strong>
            </button>
          );
        })}
      </div>

      {detail && (
        <p style={{ fontSize: 13, opacity: 0.78, marginTop: 8, maxWidth: 560 }}>
          {detail.description} Plays to {detail.victoryPointsToWin}.
        </p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        marginBottom: 14,
      }}
    >
      <span style={{ width: 150, fontSize: 15, opacity: 0.85 }}>{label}</span>
      {children}
    </div>
  );
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <Button tone={on ? 'primary' : 'default'} onClick={() => onChange(!on)}>
      {on ? '✓ ' : ''}
      {label}
    </Button>
  );
}
