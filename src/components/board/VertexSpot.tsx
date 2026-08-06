'use client';

import type { PointerEvent as ReactPointerEvent } from 'react';

import { surface } from '@/lib/theme';

/**
 * A legal build spot on a vertex.
 *
 * The drawn marker is small enough not to clutter the board; the thing that
 * actually receives the tap is the invisible circle on top, which is at least
 * 44 CSS pixels across (`hitRadius` is computed by <Board> from the live zoom).
 * Never make the player hit the art.
 *
 * Vertex spots are painted after edge spots so that where the two overlap —
 * an edge midpoint is only half a hex-side from its endpoints — the vertex
 * wins. Tap-to-confirm makes the ambiguity recoverable either way.
 */

export interface SpotProps {
  x: number;
  y: number;
  size: number;
  /** Radius of the invisible hit circle, in board-world units. */
  hitRadius: number;
  pending?: boolean;
  label: string;
  onTap: (e: ReactPointerEvent) => void;
}

export function VertexSpot({
  x,
  y,
  size,
  hitRadius,
  pending,
  label,
  onTap,
}: SpotProps) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {!pending && (
        <>
          <circle
            className="asb-pulse"
            r={size * 0.24}
            fill={surface('highlight')}
            opacity={0.32}
          />
          <circle
            r={size * 0.13}
            fill={surface('highlight')}
            stroke={surface('token-bg')}
            strokeWidth={size * 0.03}
          />
        </>
      )}
      {pending && <ConfirmBadge size={size} dy={-size * 0.62} />}
      <circle
        data-tap-target="vertex"
        role="button"
        aria-label={label}
        r={hitRadius}
        fill="transparent"
        onPointerUp={onTap}
      />
    </g>
  );
}

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
