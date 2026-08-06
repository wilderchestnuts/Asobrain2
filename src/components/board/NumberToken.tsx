import { surface } from '@/lib/theme';

/**
 * The production chit. Deliberately oversized relative to the hex: the number
 * and its pip count are the two things a player reads from across the table.
 */

interface NumberTokenProps {
  x: number;
  y: number;
  size: number;
  value: number;
  /** Dimmed while the robber or pirate blocks the hex. */
  muted?: boolean;
}

/** Dots under the number: how many of the 36 dice outcomes roll it. */
const pipCount = (n: number) => 6 - Math.abs(7 - n);

export function NumberToken({ x, y, size, value, muted }: NumberTokenProps) {
  const hot = value === 6 || value === 8;
  const r = size * 0.36;
  const pips = pipCount(value);
  const pipR = size * 0.03;
  const gap = size * 0.078;

  return (
    <g transform={`translate(${x} ${y})`} opacity={muted ? 0.45 : 1}>
      <circle
        r={r}
        fill={surface('token-bg')}
        stroke={surface('token-edge')}
        strokeWidth={size * 0.02}
      />
      <text
        y={-size * 0.02}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * (hot ? 0.46 : 0.42)}
        fontWeight={hot ? 900 : 700}
        fill={hot ? surface('token-hot') : surface('token-ink')}
        style={{ fontFamily: 'var(--font-sans, system-ui), system-ui, sans-serif' }}
      >
        {value}
      </text>
      <g fill={hot ? surface('token-hot') : surface('token-ink')}>
        {Array.from({ length: pips }, (_, i) => (
          <circle
            key={i}
            cx={(i - (pips - 1) / 2) * gap}
            cy={size * 0.215}
            r={pipR}
          />
        ))}
      </g>
    </g>
  );
}
