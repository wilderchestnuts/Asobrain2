'use client';

import type { PointerEvent as ReactPointerEvent } from 'react';

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
  hitRadius,
  pending,
  label,
  onTap,
  angle,
}: SpotProps & { angle: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {/*
        A plain capsule, no pulsing halo behind it. The animation added motion
        without adding information, and on a board full of legal road spots it
        was just noise.
      */}
      {!pending && (
        <g transform={`rotate(${angle.toFixed(2)})`}>
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
      {pending && <ConfirmBadge size={size} dy={-size * BADGE_DY} />}
      <circle
        data-tap-target="edge"
        role="button"
        aria-label={label}
        r={hitRadius}
        fill="transparent"
        onPointerUp={onTap}
      />
      {/* The badge needs its own hit area — see VertexSpot. */}
      {pending && (
        <circle
          data-tap-target="edge"
          role="button"
          aria-label={`Confirm: ${label}`}
          cy={-size * BADGE_DY}
          r={Math.max(hitRadius, size * 0.34)}
          fill="transparent"
          onPointerUp={onTap}
        />
      )}
    </g>
  );
}
