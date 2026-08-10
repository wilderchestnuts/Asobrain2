import type { PlayerStyle } from '@/lib/theme';
import { surface } from '@/lib/theme';

/**
 * The Cities & Knights merchant.
 *
 * A market stall rather than a figure, because it means something different
 * from the robber and the pirate: those block a hex for everyone, this one
 * belongs to somebody. So it wears the owner's colour, and sits to the right
 * of centre — the robber already occupies the left, and the two can share a
 * hex.
 */
export function Merchant({
  x,
  y,
  size,
  style,
}: {
  x: number;
  y: number;
  size: number;
  style: PlayerStyle;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 100})`} pointerEvents="none">
      {/* awning */}
      <path
        d="M-26 -10 L-20 -30 L20 -30 L26 -10 Z"
        fill={style.base}
        stroke={style.ink}
        strokeWidth={4}
        strokeLinejoin="round"
      />
      {/* scalloped hem, so it reads as cloth and not a roof */}
      <path
        d="M-26 -10 Q-19.5 -3 -13 -10 Q-6.5 -3 0 -10 Q6.5 -3 13 -10 Q19.5 -3 26 -10"
        fill="none"
        stroke={style.ink}
        strokeWidth={3.5}
        strokeLinejoin="round"
      />
      {/* counter */}
      <rect
        x={-21}
        y={-4}
        width={42}
        height={26}
        rx={3}
        fill={surface('token-bg')}
        stroke={style.ink}
        strokeWidth={4}
      />
      {/* a coin on the counter — the two-for-one is the whole point of it */}
      <circle cx={0} cy={9} r={7} fill={style.base} stroke={style.ink} strokeWidth={3} />
    </g>
  );
}
