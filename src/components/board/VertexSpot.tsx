'use client';

import { surface } from '@/lib/theme';

/**
 * A legal build spot on a vertex — purely a marker.
 *
 * Taps are not handled here. <Board> resolves a tap to the nearest legal spot
 * instead, because at low zoom a finger-sized hit area is wider than the gap
 * between neighbouring spots, and overlapping circles meant the wrong one won.
 */

export interface SpotProps {
  x: number;
  y: number;
  size: number;
  pending?: boolean;
  label: string;
}

export function VertexSpot({ x, y, size, pending, label }: SpotProps) {
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none" aria-label={label}>
      {/*
        A still amber ring, not a pulsing disc. The animation drew the eye to
        the motion rather than to the spot, and with dozens of legal places at
        once the whole board shimmered.
      */}
      {!pending && (
        <circle
          r={size * 0.17}
          fill="none"
          stroke={surface('highlight-ring')}
          strokeWidth={size * 0.06}
          opacity={0.95}
        />
      )}
      {pending && <ConfirmBadge size={size} dy={-size * BADGE_DY} />}
    </g>
  );
}

/** How far above the spot the confirm badge sits, in hex radii. */
export const BADGE_DY = 0.62;

/** "Tap again to build" affordance shown over a pending selection. */
export function ConfirmBadge({ size, dy }: { size: number; dy: number }) {
  const r = size * 0.24;
  return (
    <g transform={`translate(0 ${dy})`} className="asb-bob" pointerEvents="none">
      <circle
        r={r}
        fill={surface('confirm')}
        stroke={surface('token-bg')}
        strokeWidth={size * 0.035}
      />
      <path
        d={`M${-r * 0.44} 0 L${-r * 0.1} ${r * 0.36} L${r * 0.5} ${-r * 0.4}`}
        fill="none"
        stroke={surface('token-bg')}
        strokeWidth={size * 0.055}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}
