'use client';

/**
 * Shared chrome for the game screen.
 *
 * Everything here obeys the same iPad rules as the board: nothing smaller than
 * 44px is tappable, nothing depends on hover, and the sheets slide from the
 * bottom so a thumb can reach them in landscape.
 */

import type { CSSProperties, ReactNode } from 'react';

import { surface, TRACK_COLORS } from '@/lib/theme';
import type { ImprovementTrack, Tradeable } from '@/game/types';

/** Card colours, distinct enough to read at a glance without labels. */
export const CARD_COLOR: Record<Tradeable, string> = {
  brick: '#C1683A',
  lumber: '#2E7D4F',
  wool: '#8CC152',
  grain: '#E6BE3E',
  ore: '#8A90A2',
  coin: '#D4A017',
  paper: '#4C9BEF',
  cloth: '#1FC79A',
};

export const CARD_LABEL: Record<Tradeable, string> = {
  brick: 'Brick',
  lumber: 'Lumber',
  wool: 'Wool',
  grain: 'Grain',
  ore: 'Ore',
  coin: 'Coin',
  paper: 'Paper',
  cloth: 'Cloth',
};

/** Short glyph so a card is identifiable when the label will not fit. */
export const CARD_GLYPH: Record<Tradeable, string> = {
  brick: '▬',
  lumber: '🌲',
  wool: '🐑',
  grain: '🌾',
  ore: '⛰',
  coin: '🪙',
  paper: '📜',
  cloth: '🧵',
};

export const TAP = 44;

export const panel: CSSProperties = {
  background: surface('chrome'),
  borderColor: surface('chrome-edge'),
  color: surface('chrome-ink'),
};

// ---------------------------------------------------------------------------

export function Button({
  children,
  onClick,
  disabled,
  tone = 'default',
  wide,
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'danger' | 'ghost';
  wide?: boolean;
  style?: CSSProperties;
}) {
  const tones: Record<string, CSSProperties> = {
    default: { background: surface('chrome'), color: surface('chrome-ink') },
    primary: { background: surface('confirm'), color: '#fff', fontWeight: 600 },
    danger: { background: '#B4232A', color: '#fff', fontWeight: 600 },
    ghost: { background: 'transparent', color: surface('chrome-ink') },
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: TAP,
        padding: wide ? '0 22px' : '0 14px',
        borderRadius: 12,
        border: `1px solid ${surface('chrome-edge')}`,
        fontSize: 15,
        touchAction: 'manipulation',
        opacity: disabled ? 0.4 : 1,
        whiteSpace: 'nowrap',
        ...tones[tone],
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** A resource or commodity card. Tapping is optional. */
export function Card({
  kind,
  count,
  onTap,
  selected,
  small,
}: {
  kind: Tradeable;
  count: number;
  onTap?: () => void;
  selected?: boolean;
  small?: boolean;
}) {
  // Sized up: these are the numbers you read most often in a turn, and the old
  // small variant was hard to scan at a glance.
  const w = small ? 54 : 64;
  return (
    <button
      type="button"
      onClick={onTap}
      disabled={!onTap}
      aria-label={`${count} ${CARD_LABEL[kind]}`}
      style={{
        width: w,
        minHeight: small ? TAP + 8 : TAP + 18,
        borderRadius: 10,
        border: `2px solid ${selected ? surface('confirm') : surface('chrome-edge')}`,
        background: CARD_COLOR[kind],
        color: '#fff',
        display: 'grid',
        placeItems: 'center',
        gap: 0,
        fontWeight: 700,
        fontSize: small ? 19 : 22,
        textShadow: '0 1px 2px rgba(0,0,0,.45)',
        touchAction: 'manipulation',
        opacity: count === 0 ? 0.35 : 1,
      }}
    >
      <span style={{ fontSize: small ? 13 : 15, lineHeight: 1 }}>
        {CARD_GLYPH[kind]}
      </span>
      <span style={{ lineHeight: 1 }}>{count}</span>
    </button>
  );
}

/** Bottom sheet. Used for trades, C&K panels and anything the rules demand. */
export function Sheet({
  open,
  title,
  onClose,
  children,
  dismissable = true,
}: {
  open: boolean;
  title: string;
  onClose?: () => void;
  children: ReactNode;
  /** Rules-mandated sheets cannot be dismissed — the game is waiting. */
  dismissable?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,.45)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 40,
      }}
      onClick={() => dismissable && onClose?.()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          ...panel,
          width: 'min(760px, 100%)',
          maxHeight: '78%',
          overflowY: 'auto',
          borderRadius: '18px 18px 0 0',
          borderWidth: '1px 1px 0',
          borderStyle: 'solid',
          padding: `16px 16px max(16px, env(safe-area-inset-bottom))`,
          boxShadow: '0 -10px 40px rgba(0,0,0,.3)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <h2 style={{ fontSize: 19, fontWeight: 700 }}>{title}</h2>
          {dismissable && onClose && (
            <Button onClick={onClose} tone="ghost">
              Close
            </Button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/** The three Cities & Knights improvement tracks as a compact meter. */
export function TrackMeter({
  track,
  level,
  metropolis,
}: {
  track: ImprovementTrack;
  level: number;
  metropolis?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 11, width: 46, opacity: 0.8 }}>{track}</span>
      <div style={{ display: 'flex', gap: 2 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            style={{
              width: 9,
              height: 14,
              borderRadius: 2,
              background:
                i <= level
                  ? TRACK_COLORS[track].light
                  : surface('chrome-edge'),
            }}
          />
        ))}
      </div>
      {metropolis && <span title="Metropolis">★</span>}
    </div>
  );
}

/** Toast for a rejected action. The server is authoritative, so this happens. */
export function Toast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        top: 'max(70px, calc(env(safe-area-inset-top) + 70px))',
        background: '#B4232A',
        color: '#fff',
        padding: '10px 16px',
        borderRadius: 12,
        fontSize: 15,
        zIndex: 50,
        maxWidth: '80%',
        boxShadow: '0 6px 24px rgba(0,0,0,.35)',
      }}
    >
      {message}
    </div>
  );
}
