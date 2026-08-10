'use client';

/**
 * A thumbnail of a map: bare terrain, no pieces, no numbers, no interaction.
 *
 * Every preset used to be picked blind from a dropdown, so "The Long Chain"
 * and "Six Islands" were just two names. What distinguishes a map at a glance
 * is its silhouette — where the land is, where the fog is — and that survives
 * being drawn 120px wide, where a number token would not.
 *
 * The board is built from a fixed seed rather than the game's, because a
 * preview that reshuffled on every render would be worse than none. The
 * shuffle only moves terrain around within a shape the scenario fixes, so the
 * layout shown is the layout you get.
 */

import { useMemo } from 'react';

import { hexCorners, hexToPixel } from '@/game/hex';
import { Rng } from '@/game/rng';
import { getScenario } from '@/game/scenarios';
import type { Board } from '@/game/types';
import { surface, terrainFill } from '@/lib/theme';

const HEX = 10;
const PREVIEW_SEED = 'preview';

export function BoardPreview({
  scenarioId,
  width = 132,
  height = 104,
}: {
  scenarioId: string;
  width?: number;
  height?: number;
}) {
  const board = useMemo<Board | null>(() => {
    const scenario = getScenario(scenarioId);
    if (!scenario) return null;
    try {
      return scenario.build(new Rng(PREVIEW_SEED));
    } catch {
      // A preview is never worth failing a page render over.
      return null;
    }
  }, [scenarioId]);

  if (!board) {
    return <div style={{ width, height }} aria-hidden />;
  }

  const box = extent(board);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`${box.minX} ${box.minY} ${box.w} ${box.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Map layout for ${getScenario(scenarioId)?.name ?? scenarioId}`}
      style={{ display: 'block', borderRadius: 8, background: surface('board-bg') }}
    >
      {board.hexes.map((hex, i) => (
        <polygon
          key={i}
          points={hexCorners(hex.coord, HEX)
            .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
            .join(' ')}
          fill={terrainFill(hex.terrain)}
          stroke={surface('hex-edge')}
          strokeWidth={0.35}
          strokeLinejoin="round"
        />
      ))}

      {/* Ports as ticks on the coast: they say "there is coastline here",
          which is part of a map's character even at this size. */}
      {board.ports.map((port, i) => {
        const p = hexToPixel(port.hex, HEX);
        return (
          <circle
            key={`p-${i}`}
            cx={p.x}
            cy={p.y}
            r={HEX * 0.16}
            fill={surface('chrome-ink')}
            opacity={0.45}
          />
        );
      })}
    </svg>
  );
}

/** World extent with a little air around it, so nothing touches the frame. */
function extent(board: Board) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const hex of board.hexes) {
    const c = hexToPixel(hex.coord, HEX);
    minX = Math.min(minX, c.x - HEX);
    maxX = Math.max(maxX, c.x + HEX);
    minY = Math.min(minY, c.y - HEX);
    maxY = Math.max(maxY, c.y + HEX);
  }
  if (!Number.isFinite(minX)) return { minX: -HEX, minY: -HEX, w: HEX * 2, h: HEX * 2 };
  const pad = HEX * 0.3;
  return {
    minX: minX - pad,
    minY: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}
