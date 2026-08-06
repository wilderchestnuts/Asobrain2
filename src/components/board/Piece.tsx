import type { ReactElement } from 'react';

import type { ImprovementTrack, KnightRank } from '@/game/types';
import { surface, trackColor, type PlayerEmblem, type PlayerStyle } from '@/lib/theme';

/**
 * All the owned pieces. Every one carries the player's emblem or dash pattern
 * as well as their colour, so the board stays readable for a colourblind
 * player and in a photo/screenshot.
 *
 * Shapes are authored against a 100-unit hex and scaled by `size / 100`, which
 * keeps the proportions honest whatever the fitted board scale turns out to be.
 */

export interface PieceStyleProps {
  style: PlayerStyle;
  size: number;
  /** Ghost previews are translucent and dashed. */
  ghost?: boolean;
}

const u = (size: number) => size / 100;

const ghostProps = (ghost?: boolean) =>
  ghost
    ? { opacity: 0.55, strokeDasharray: '7 5' }
    : {};

// ---------------------------------------------------------------------------
// Emblems
// ---------------------------------------------------------------------------

/** Per-player mark, so colour is never the only way to tell seats apart. */
export function Emblem({
  shape,
  r,
  fill,
}: {
  shape: PlayerEmblem;
  r: number;
  fill: string;
}): ReactElement {
  switch (shape) {
    case 'circle':
      return <circle r={r} fill={fill} />;
    case 'triangle':
      return (
        <polygon
          points={`0,${-r * 1.1} ${r} ${r * 0.75} ${-r},${r * 0.75}`}
          fill={fill}
        />
      );
    case 'diamond':
      return (
        <polygon
          points={`0,${-r * 1.2} ${r * 1.05},0 0,${r * 1.2} ${-r * 1.05},0`}
          fill={fill}
        />
      );
    case 'star':
      return (
        <polygon
          points={Array.from({ length: 10 }, (_, i) => {
            const rad = i % 2 ? r * 0.46 : r * 1.2;
            const a = (Math.PI / 5) * i - Math.PI / 2;
            return `${(Math.cos(a) * rad).toFixed(2)},${(Math.sin(a) * rad).toFixed(2)}`;
          }).join(' ')}
          fill={fill}
        />
      );
    case 'square':
      return <rect x={-r * 0.9} y={-r * 0.9} width={r * 1.8} height={r * 1.8} fill={fill} />;
    case 'cross':
      return (
        <path
          d={`M${-r * 1.2} ${-r * 0.42}h${r * 0.78}v${-r * 0.78}h${r * 0.84}v${r * 0.78}h${r * 0.78}v${r * 0.84}h${-r * 0.78}v${r * 0.78}h${-r * 0.84}v${-r * 0.78}h${-r * 0.78}z`}
          fill={fill}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Vertex pieces
// ---------------------------------------------------------------------------

export interface BuildingProps extends PieceStyleProps {
  x: number;
  y: number;
  kind: 'settlement' | 'city';
  wall?: boolean;
  metropolis?: ImprovementTrack;
}

const SETTLEMENT_PATH =
  'M-24 17 L-24 -2 L0 -25 L24 -2 L24 17 Z';
const CITY_PATH =
  'M-31 20 L-31 -13 L-17 -30 L-3 -13 L-3 -3 L31 -3 L31 20 Z';

export function Building({
  x,
  y,
  kind,
  wall,
  metropolis,
  style,
  size,
  ghost,
}: BuildingProps) {
  const s = u(size);
  const city = kind === 'city';
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} {...ghostProps(ghost)}>
      {wall && (
        <path
          d="M-40 22 v-13 h7 v6 h7 v-6 h7 v6 h7 v-6 h7 v6 h7 v-6 h7 v13 z"
          fill={surface('token-bg')}
          stroke={surface('token-edge')}
          strokeWidth={3}
          strokeLinejoin="round"
        />
      )}
      <path
        d={city ? CITY_PATH : SETTLEMENT_PATH}
        fill={style.base}
        stroke={style.ink}
        strokeWidth={5}
        strokeLinejoin="round"
      />
      <g transform={city ? 'translate(14 9)' : 'translate(0 5)'}>
        <Emblem shape={style.emblem} r={city ? 9 : 8.5} fill={style.lite} />
      </g>
      {metropolis && (
        <g transform="translate(-17 -44)">
          <path
            d="M0 -12 L3.6 -3.6 L12 -3.6 L5.4 1.8 L7.8 10 L0 5 L-7.8 10 L-5.4 1.8 L-12 -3.6 L-3.6 -3.6 Z"
            fill={trackColor(metropolis)}
            stroke={surface('ink')}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
        </g>
      )}
    </g>
  );
}

export interface KnightPieceProps extends PieceStyleProps {
  x: number;
  y: number;
  rank: KnightRank;
  active: boolean;
}

const SHIELD_PATH =
  'M0 -30 L23 -22 L23 2 Q23 22 0 31 Q-23 22 -23 2 L-23 -22 Z';

export function KnightPiece({
  x,
  y,
  rank,
  active,
  style,
  size,
  ghost,
}: KnightPieceProps) {
  const s = u(size);
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} {...ghostProps(ghost)}>
      <path
        d={SHIELD_PATH}
        fill={active ? style.base : surface('token-bg')}
        stroke={style.ink}
        strokeWidth={5}
        strokeLinejoin="round"
        strokeDasharray={active ? undefined : '9 6'}
      />
      {active && (
        <path
          d={SHIELD_PATH}
          fill="none"
          stroke={style.lite}
          strokeWidth={2.5}
          transform="scale(0.78)"
        />
      )}
      <g fill={active ? style.lite : style.base}>
        {Array.from({ length: rank }, (_, i) => (
          <circle
            key={i}
            cx={(i - (rank - 1) / 2) * 12}
            cy={-4}
            r={4.4}
          />
        ))}
      </g>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Edge pieces
// ---------------------------------------------------------------------------

export interface EdgePieceProps extends PieceStyleProps {
  x: number;
  y: number;
  angle: number;
  kind: 'road' | 'ship';
}

/** Keep pieces from being drawn upside down on the 150-degree edges. */
const uprightAngle = (a: number) => {
  let d = a;
  while (d > 90) d -= 180;
  while (d <= -90) d += 180;
  return d;
};

const SHIP_HULL =
  'M-42 -6 L42 -6 L30 12 Q0 20 -30 12 Z';

export function EdgePiece({
  x,
  y,
  angle,
  kind,
  style,
  size,
  ghost,
}: EdgePieceProps) {
  const s = u(size);
  const rot = uprightAngle(angle);
  return (
    <g
      transform={`translate(${x} ${y}) rotate(${rot.toFixed(2)}) scale(${s})`}
      {...ghostProps(ghost)}
    >
      {kind === 'road' ? (
        <>
          <rect
            x={-39}
            y={-13}
            width={78}
            height={26}
            rx={9}
            fill={style.base}
            stroke={style.ink}
            strokeWidth={5}
          />
          <line
            x1={-28}
            y1={0}
            x2={28}
            y2={0}
            stroke={style.lite}
            strokeWidth={7}
            strokeLinecap="round"
            strokeDasharray={style.dash || undefined}
          />
        </>
      ) : (
        <>
          <path
            d={SHIP_HULL}
            fill={style.base}
            stroke={style.ink}
            strokeWidth={5}
            strokeLinejoin="round"
          />
          <line
            x1={0}
            y1={-8}
            x2={0}
            y2={-38}
            stroke={style.ink}
            strokeWidth={5}
            strokeLinecap="round"
          />
          <path
            d="M3 -36 L26 -12 L3 -12 Z"
            fill={style.lite}
            stroke={style.ink}
            strokeWidth={4}
            strokeLinejoin="round"
          />
          <g transform="translate(-20 3)">
            <Emblem shape={style.emblem} r={6} fill={style.lite} />
          </g>
        </>
      )}
    </g>
  );
}
