import { surface } from '@/lib/theme';

/**
 * The Seafarers pirate. Same ink as the robber so both read as "blocked", but
 * a two-masted ship rather than a pawn — the silhouettes are different enough
 * to tell apart at a glance on a busy sea.
 */
export function Pirate({ x, y, size }: { x: number; y: number; size: number }) {
  const ink = surface('robber');
  const rim = surface('robber-rim');
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 100})`}>
      <line x1={0} y1={4} x2={0} y2={-40} stroke={ink} strokeWidth={6} strokeLinecap="round" />
      <path
        d="M-4 -38 L-4 -8 L-31 -14 Z"
        fill={ink}
        stroke={rim}
        strokeWidth={3.5}
        strokeLinejoin="round"
      />
      <path
        d="M4 -38 L4 -8 L30 -14 Z"
        fill={ink}
        stroke={rim}
        strokeWidth={3.5}
        strokeLinejoin="round"
      />
      <path
        d="M-42 2 L42 2 L28 24 Q0 33 -28 24 Z"
        fill={ink}
        stroke={rim}
        strokeWidth={4}
        strokeLinejoin="round"
      />
    </g>
  );
}
