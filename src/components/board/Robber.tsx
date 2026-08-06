import { surface } from '@/lib/theme';

/**
 * A dark pawn, drawn to the left of the hex centre so it never buries the
 * number token — the blocked hex also gets a dimming overlay, so the two
 * signals reinforce each other.
 */
export function Robber({ x, y, size }: { x: number; y: number; size: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 100})`}>
      <path
        d="M-17 30 Q-17 2 -8 -6 Q-16 -12 -16 -20 A16 16 0 0 1 16 -20 Q16 -12 8 -6 Q17 2 17 30 Z"
        fill={surface('robber')}
        stroke={surface('robber-rim')}
        strokeWidth={4}
        strokeLinejoin="round"
      />
      <ellipse
        cx={0}
        cy={31}
        rx={22}
        ry={6.5}
        fill={surface('robber')}
        stroke={surface('robber-rim')}
        strokeWidth={3}
      />
    </g>
  );
}
