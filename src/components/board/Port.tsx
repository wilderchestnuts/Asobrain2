import { hexToPixel, vertexToPixel } from '@/game/hex';
import type { Port as PortModel } from '@/game/types';
import { surface, TRADEABLE_GLYPH } from '@/lib/theme';

/**
 * A harbour plaque on the sea hex with two mooring lines out to the vertices
 * that can actually use it. Showing the lines is what stops players guessing
 * which of the coast's many corners the port belongs to.
 */
export function Port({ port, size }: { port: PortModel; size: number }) {
  const hexCentre = hexToPixel(port.hex, size);
  const ends = port.vertices.map((v) => vertexToPixel(v, size));
  if (ends.length === 0) return null;

  const mid = {
    x: ends.reduce((s, p) => s + p.x, 0) / ends.length,
    y: ends.reduce((s, p) => s + p.y, 0) / ends.length,
  };
  // Sit the plaque between the sea-hex centre and the moorings, so it stays
  // clear of the neighbouring land tile.
  const at = {
    x: hexCentre.x + (mid.x - hexCentre.x) * 0.42,
    y: hexCentre.y + (mid.y - hexCentre.y) * 0.42,
  };

  const generic = port.ratio === 3 || port.kind === 'any';
  const w = size * (generic ? 0.56 : 0.78);
  const h = size * 0.32;

  return (
    <g>
      {ends.map((p, i) => (
        <line
          key={i}
          x1={at.x}
          y1={at.y}
          x2={p.x}
          y2={p.y}
          stroke={surface('port-ink')}
          strokeWidth={size * 0.05}
          strokeLinecap="round"
          opacity={0.6}
        />
      ))}
      <g transform={`translate(${at.x} ${at.y})`}>
        <rect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          rx={h * 0.32}
          fill={surface('port-bg')}
          stroke={surface('port-ink')}
          strokeWidth={size * 0.022}
        />
        <text
          x={generic ? 0 : -w * 0.16}
          y={size * 0.005}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size * 0.2}
          fontWeight={800}
          fill={surface('port-ink')}
          style={{ fontFamily: 'var(--font-sans, system-ui), system-ui, sans-serif' }}
        >
          {port.ratio}:1
        </text>
        {!generic && (
          <g
            transform={`translate(${w * 0.2 - size * 0.115} ${-size * 0.115}) scale(${(size * 0.23) / 24})`}
            fill={surface('port-ink')}
          >
            <path d={TRADEABLE_GLYPH[port.kind]} />
          </g>
        )}
      </g>
    </g>
  );
}
