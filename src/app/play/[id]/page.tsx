'use client';

import { use } from 'react';

import { GameScreen } from '@/components/game/GameScreen';
import { Button } from '@/components/game/parts';
import { useGame } from '@/hooks/useGame';
import { surface } from '@/lib/theme';

export default function PlayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const game = useGame(id);

  if (game.error) {
    return (
      <main
        style={{
          display: 'grid',
          placeItems: 'center',
          height: '100dvh',
          gap: 14,
          background: surface('board-bg'),
          color: surface('chrome-ink'),
        }}
      >
        <p>{game.error}</p>
        <a href="/">
          <Button>Back to games</Button>
        </a>
      </main>
    );
  }

  // A game you have not taken a seat in yet — the second player following a
  // shared link lands here.
  if (game.view && game.mySeat === null && game.view.status !== 'finished') {
    return (
      <main
        style={{
          display: 'grid',
          placeItems: 'center',
          height: '100dvh',
          gap: 16,
          padding: 20,
          textAlign: 'center',
          background: surface('board-bg'),
          color: surface('chrome-ink'),
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Join this game?</h1>
        <p style={{ opacity: 0.8 }}>
          {game.view.seats.filter((s) => !s.claimed && !s.isBot).length} open
          seat(s)
        </p>
        <Button tone="primary" wide onClick={() => void game.join()}>
          Take a seat
        </Button>
      </main>
    );
  }

  // Waiting on a second human. Showing the board here would be worse than
  // useless: every tap would be refused by the server, so show the invite
  // instead — this is the "easy to join and just play" moment.
  if (game.view && game.view.status === 'lobby') {
    return <WaitingRoom game={game} />;
  }

  return <GameScreen game={game} />;
}

function WaitingRoom({ game }: { game: ReturnType<typeof useGame> }) {
  const open = game.view!.seats.filter((s) => !s.claimed && !s.isBot);
  const link = typeof window === 'undefined' ? '' : window.location.href;

  return (
    <main
      style={{
        display: 'grid',
        placeItems: 'center',
        minHeight: '100dvh',
        padding: 24,
        background: surface('board-bg'),
        color: surface('chrome-ink'),
      }}
    >
      <div style={{ maxWidth: 520, textAlign: 'center', display: 'grid', gap: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Waiting for players</h1>
        <p style={{ opacity: 0.8 }}>
          Send this link to {open.length === 1 ? 'your other player' : 'the others'}.
          The game starts the moment {open.length === 1 ? 'they take' : 'they take'} a
          seat.
        </p>

        <code
          style={{
            display: 'block',
            padding: 14,
            borderRadius: 12,
            background: surface('chrome'),
            border: `1px solid ${surface('chrome-edge')}`,
            fontSize: 14,
            wordBreak: 'break-all',
          }}
        >
          {link}
        </code>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <Button
            tone="primary"
            onClick={() => void navigator.clipboard?.writeText(link)}
          >
            Copy link
          </Button>
          <Button onClick={() => void game.refresh()}>Check again</Button>
        </div>

        <ul style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {game.view!.seats.map((s) => (
            <li key={s.seat} style={{ opacity: s.claimed || s.isBot ? 1 : 0.55 }}>
              {s.name} — {s.isBot ? 'computer' : s.claimed ? 'ready' : 'waiting'}
            </li>
          ))}
        </ul>

        <p style={{ fontSize: 13, opacity: 0.65 }}>
          This page checks for itself every few seconds.
        </p>
      </div>
    </main>
  );
}
