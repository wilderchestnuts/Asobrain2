import type { ReactElement } from 'react';

import { hexCorners, hexKey, type HexCoord } from '@/game/hex';
import type { Terrain } from '@/game/types';
import { surface, terrainFill } from '@/lib/theme';

/**
 * One terrain tile: flat fill, thin border, and a large low-contrast glyph
 * behind the number token. The glyph is drawn big rather than small — at arm's
 * length on a tablet a fine icon is just noise.
 */

interface HexProps {
  coord: HexCoord;
  terrain: Terrain;
  size: number;
}

export function Hex({ coord, terrain, size }: HexProps) {
  const pts = hexCorners(coord, size)
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');
  const c = hexCorners(coord, size).reduce(
    (a, p) => ({ x: a.x + p.x / 6, y: a.y + p.y / 6 }),
    { x: 0, y: 0 },
  );

  return (
    <g data-hex={hexKey(coord)}>
      <polygon
        points={pts}
        fill={terrainFill(terrain)}
        stroke={surface('hex-edge')}
        strokeWidth={size * 0.022}
        strokeLinejoin="round"
      />
      <g
        transform={`translate(${c.x} ${c.y})`}
        style={{ color: surface('glyph') }}
        fill="currentColor"
        stroke="none"
      >
        {TERRAIN_GLYPH[terrain](size)}
      </g>
    </g>
  );
}

// Each glyph is authored in a 100-unit hex and scaled by `s / 100`.
const g = (s: number, children: ReactElement) => (
  <g transform={`scale(${s / 100})`}>{children}</g>
);

const TERRAIN_GLYPH: Record<Terrain, (s: number) => ReactElement> = {
  hills: (s) =>
    g(
      s,
      <>
        <rect x={-46} y={-30} width={40} height={18} rx={3} />
        <rect x={6} y={-30} width={40} height={18} rx={3} />
        <rect x={-26} y={-6} width={40} height={18} rx={3} />
        <rect x={-46} y={18} width={40} height={18} rx={3} />
        <rect x={6} y={18} width={40} height={18} rx={3} />
      </>,
    ),
  forest: (s) =>
    g(
      s,
      <>
        <path d="M0 -44 L26 -6 H12 L34 30 H-34 L-12 -6 H-26 Z" />
        <rect x={-7} y={26} width={14} height={20} rx={3} />
      </>,
    ),
  pasture: (s) =>
    g(
      s,
      <>
        <circle cx={-20} cy={-4} r={22} />
        <circle cx={12} cy={-16} r={20} />
        <circle cx={20} cy={8} r={18} />
        <rect x={-24} y={12} width={9} height={24} rx={4} />
        <rect x={14} y={16} width={9} height={24} rx={4} />
      </>,
    ),
  fields: (s) =>
    g(
      s,
      <>
        <rect x={-5} y={-40} width={10} height={80} rx={5} />
        <path d="M0 -44 C18 -28 22 -8 14 6 C-2 -2 -6 -24 0 -44 Z" />
        <path d="M0 -44 C-18 -28 -22 -8 -14 6 C2 -2 6 -24 0 -44 Z" />
        <path d="M34 -12 C30 10 18 22 4 24 C6 8 16 -6 34 -12 Z" />
        <path d="M-34 -12 C-30 10 -18 22 -4 24 C-6 8 -16 -6 -34 -12 Z" />
      </>,
    ),
  mountains: (s) =>
    g(
      s,
      <>
        <path d="M-52 34 L-14 -30 L8 6 L24 -18 L52 34 Z" />
      </>,
    ),
  desert: (s) =>
    g(
      s,
      <>
        <circle cx={22} cy={-28} r={14} />
        <path d="M-52 16 C-32 -4 -14 -4 2 12 C14 2 30 2 46 16 Z" />
        <path d="M-52 36 C-26 18 -4 18 14 34 Z" />
      </>,
    ),
  sea: (s) =>
    g(
      s,
      <>
        <path
          d="M-46 -14 C-30 -28 -14 0 2 -14 C18 -28 34 0 46 -14"
          fill="none"
          stroke="currentColor"
          strokeWidth={9}
          strokeLinecap="round"
        />
        <path
          d="M-46 18 C-30 4 -14 32 2 18 C18 4 34 32 46 18"
          fill="none"
          stroke="currentColor"
          strokeWidth={9}
          strokeLinecap="round"
        />
      </>,
    ),
  gold: (s) =>
    g(
      s,
      <>
        <path d="M0 -46 L12 -14 L46 -14 L18 6 L29 38 L0 18 L-29 38 L-18 6 L-46 -14 L-12 -14 Z" />
      </>,
    ),
  fog: (s) =>
    g(
      s,
      <>
        <path d="M-40 18 A22 22 0 0 1 -30 -22 A26 26 0 0 1 16 -30 A22 22 0 0 1 40 6 A18 18 0 0 1 30 18 Z" />
        <rect x={-44} y={26} width={54} height={10} rx={5} />
        <rect x={18} y={26} width={26} height={10} rx={5} />
      </>,
    ),
};
