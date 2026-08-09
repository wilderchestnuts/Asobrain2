'use client';

/**
 * The play-by-play: what just happened, at a pace you can read.
 *
 * Sits over the board rather than beside it, because during someone else's
 * turn the board is not being interacted with anyway, and a panel in the
 * corner gets ignored. It never blocks input — the skip button is always
 * there, and taking your own turn is unaffected.
 */

import type { LogEntry, Player, Tradeable } from '@/game/types';
import { playerStyles, surface, TRACK_COLORS } from '@/lib/theme';

import { Button, CARD_COLOR, CARD_GLYPH, CARD_LABEL, panel } from './parts';

/** Pip layout for a die face, in a 3×3 grid. */
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
};

function Die({
  value,
  tint,
  ink = '#1B2430',
  size = 46,
}: {
  value: number;
  tint: string;
  ink?: string;
  size?: number;
}) {
  const pad = size * 0.22;
  const step = (size - pad * 2) / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <rect
        width={size}
        height={size}
        rx={size * 0.2}
        fill={tint}
        stroke="rgba(0,0,0,.28)"
        strokeWidth={1.5}
      />
      {(PIPS[value] ?? []).map(([cx, cy], i) => (
        <circle
          key={i}
          cx={pad + cx * step}
          cy={pad + cy * step}
          r={size * 0.085}
          fill={ink}
        />
      ))}
    </svg>
  );
}

/**
 * The Cities & Knights event die. Three of its faces send the barbarians and
 * the other three name a progress deck, so it is drawn in the deck's colour
 * rather than as another number.
 */
function EventDie({ face, size = 46 }: { face: string; size?: number }) {
  const isBarbarian = face === 'barbarian';
  const fill = isBarbarian
    ? '#2B2B2B'
    : (TRACK_COLORS[face as keyof typeof TRACK_COLORS]?.light ?? '#888');
  return (
    <svg width={size} height={size} viewBox="0 0 46 46" aria-label={face}>
      <rect
        width={46}
        height={46}
        rx={9}
        fill={fill}
        stroke="rgba(0,0,0,.28)"
        strokeWidth={1.5}
      />
      {isBarbarian ? (
        <g fill="#fff">
          <path d="M9 26 L37 26 L32 34 Q23 38 14 34 Z" />
          <path d="M23 24 L23 10 L34 18 Z" />
        </g>
      ) : (
        <circle cx={23} cy={23} r={9} fill="#fff" opacity={0.9} />
      )}
    </svg>
  );
}

export function PlaybackOverlay({
  entry,
  players,
  remaining,
  onSkip,
}: {
  entry: LogEntry;
  players: readonly Player[];
  remaining: number;
  onSkip: () => void;
}) {
  const styles = playerStyles(players);
  const who = players.find((p) => p.id === entry.playerId);
  const dice = entry.data?.dice;
  const gained = entry.data?.gained ?? {};
  const gainedList = Object.entries(gained).filter(([, n]) => (n ?? 0) > 0);

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: 16,
        transform: 'translateX(-50%)',
        zIndex: 30,
        pointerEvents: 'none',
        display: 'flex',
        justifyContent: 'center',
        width: 'min(560px, calc(100% - 24px))',
      }}
    >
      <div
        style={{
          ...panel,
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 12px',
          borderRadius: 14,
          border: `1px solid ${surface('chrome-edge')}`,
          boxShadow: '0 8px 28px rgba(0,0,0,.22)',
          maxWidth: '100%',
        }}
      >
        {who && (
          <span
            style={{
              width: 12,
              height: 34,
              borderRadius: 4,
              flexShrink: 0,
              background: styles[who.id]?.base,
            }}
          />
        )}

        {dice && (
          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
            <Die value={dice.white} tint="#F7F3E8" />
            <Die value={dice.red} tint="#C62828" ink="#FFF3F3" />
            {dice.event && <EventDie face={dice.event} />}
          </div>
        )}

        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 15, lineHeight: 1.25 }}>
            {who ? <strong>{who.name}</strong> : null}
            {who ? ' ' : null}
            {entry.message}
          </p>

          {gainedList.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
              {gainedList.map(([kind, n]) => (
                <span
                  key={kind}
                  aria-label={`${n} ${CARD_LABEL[kind as Tradeable]}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 7px',
                    borderRadius: 7,
                    background: CARD_COLOR[kind as Tradeable],
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 700,
                    textShadow: '0 1px 2px rgba(0,0,0,.4)',
                  }}
                >
                  {CARD_GLYPH[kind as Tradeable]} {n}
                </span>
              ))}
            </div>
          )}

          {entry.kind === 'barbarian' && entry.data?.position !== undefined && (
            <p style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>
              {(entry.data.attacksAt ?? 7) - entry.data.position} roll
              {(entry.data.attacksAt ?? 7) - entry.data.position === 1 ? '' : 's'}{' '}
              until they attack
            </p>
          )}
        </div>

        <Button tone="ghost" onClick={onSkip} style={{ flexShrink: 0 }}>
          {remaining > 0 ? `Skip ${remaining}` : 'Skip'}
        </Button>
      </div>
    </div>
  );
}
