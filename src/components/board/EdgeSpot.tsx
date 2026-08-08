'use client';

import { surface } from '@/lib/theme';
import { BADGE_DY, ConfirmBadge, type SpotProps } from './VertexSpot';

/**
 * A legal build spot on an edge. The marker is a capsule lying along the edge
 * so it reads as "a road goes here" rather than "a settlement goes here", but
 * the hit area is still a circle of at least 44 CSS pixels.
 */
export function EdgeSpot({
  x,
  y,
  size,
  pending,
  label,
  angle,
}: SpotProps & { angle: number }) {
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none" aria-label={label}>
      {/*
        A plain capsule, no pulsing halo behind it. The animation added motion
        without adding information, and on a board full of legal road spots it
        was just noise.
      */}
      {!pending && (
        <g transform={`rotate(${angle.toFixed(2)})`}>
          <rect
            x={-size * 0.24}
            y={-size * 0.055}
            width={size * 0.48}
            height={size * 0.11}
            rx={size * 0.055}
            fill="none"
            stroke={surface('highlight-ring')}
            strokeWidth={size * 0.055}
            opacity={0.95}
          />
        </g>
      )}
      {pending && <ConfirmBadge size={size} dy={-size * BADGE_DY} />}
    </g>
  );
}
