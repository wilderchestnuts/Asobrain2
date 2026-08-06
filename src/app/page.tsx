'use client';

/**
 * Lobby.
 *
 * "Easy to join and just play" was the thing the owners most wanted to keep
 * from the game this replaces, so the default path is one tap: the New game
 * button comes pre-filled with a sensible setup and everything else is optional.
 */

import { useCallback, useEffect, useState } from 'react';

import { Button, TAP, panel } from '@/components/game/parts';
import {
  createGame,
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

  const refresh = useCallback(async () => {
    setMe(await fetchMe());
    setGames(await listMyGames());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const target = vp ?? defaultVictoryPoints({ seafarers, citiesAndKnights });

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
          { kind: 'me' },
          { kind: 'human', name: 'Player 2' },
          ...Array.from({ length: bots }, (_, i) => ({
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

          <Row label="Expansions">
            <Toggle on={seafarers} onChange={setSeafarers} label="Seafarers" />
            <Toggle
              on={citiesAndKnights}
              onChange={setCitiesAndKnights}
              label="Cities &amp; Knights"
            />
          </Row>

          {seafarers && (
            <Row label="Map">
              <select
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                style={control}
              >
                <option value="random">Random island</option>
                {Object.entries(SCENARIOS)
                  .filter(([id]) => id !== 'random' && id !== 'classic')
                  .map(([id, s]) => (
                    <option key={id} value={id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </Row>
          )}

          <Row label="Computer players">
            {[0, 1, 2, 3].map((n) => (
              <Button
                key={n}
                tone={bots === n ? 'primary' : 'default'}
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
            You get a link to send to your second player. They tap it and take a
            seat — no setup on their end.
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
                <li key={g.id}>
                  <a
                    href={`/play/${g.id}`}
                    style={{
                      ...panel,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      minHeight: TAP + 14,
                      padding: '10px 16px',
                      border: `1px solid ${surface('chrome-edge')}`,
                      borderRadius: 12,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      {g.seats.map((s) => s.name).join(', ')}
                    </span>
                    <span
                      style={{ marginLeft: 'auto', opacity: 0.75, fontSize: 14 }}
                    >
                      {g.status === 'finished'
                        ? 'finished'
                        : g.currentPlayerName
                          ? `${g.currentPlayerName} to move`
                          : g.status}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
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

const control: React.CSSProperties = {
  minHeight: TAP,
  padding: '0 12px',
  borderRadius: 12,
  border: `1px solid ${surface('chrome-edge')}`,
  background: surface('chrome'),
  color: 'inherit',
  fontSize: 15,
};
