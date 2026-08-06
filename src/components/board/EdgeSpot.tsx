'use client';

import type { PointerEvent as ReactPointerEvent } from 'react';

import { surface } from '@/lib/theme';
import { ConfirmBadge, type SpotProps } from './VertexSpot';

/**
 * A legal build spot on an edge. The marker is a capsule lying along the edge
 * so it reads as "a road goes here" rather than "a settlement goes here", but
 * the hit area is still a circle of at least 44 CSS pixels.
 */
export function EdgeSpot({
  x,
  y,
  size,
  hitRadius,
  pending,
  label,
  onTap,
  angle,
}: SpotProps & { angle: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {!pending && (
        <g transform={`rotate(${angle.toFixed(2)})`}>
          <rect
            className="asb-pulse"
            x={-size * 0.34}
            y={-size * 0.13}
            width={size * 0.68}
            height={size * 0.26}
            rx={size * 0.13}
            fill={surface('highlight')}
            opacity={0.32}
          />
          <rect
            x={-size * 0.26}
            y={-size * 0.06}
            width={size * 0.52}
            height={size * 0.12}
            rx={size * 0.06}
            fill={surface('highlight')}
            stroke={surface('token-bg')}
            strokeWidth={size * 0.025}
          />
        </g>
      )}
      {pending && <ConfirmBadge size={size} dy={-size * 0.58} />}
      <circle
        data-tap-target="edge"
        role="button"
        aria-label={label}
        r={hitRadius}
        fill="transparent"
        onPointerUp={onTap}
      />
    </g>
  );
}
