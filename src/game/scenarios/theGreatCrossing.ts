/**
 * Seafarers 7 — The Great Crossing.
 *
 * Everyone starts on the western continent; the rich eastern one is three
 * hexes of open water away. Long ship chains, not roads, decide this map.
 */

import { assembleBoard, type Scenario } from '../board';
import { rows, row, SEAFARERS } from './common';

const MAP = rows(
  // western continent — the desert sits dead centre, where the robber starts
  row(-2, -4, 'fpg'),
  row(-1, -5, 'mhfp'),
  row(0, -5, 'gpdh'),
  row(1, -5, 'fgm'),
  row(2, -5, 'ph'),
  // eastern continent — smaller, but two gold hexes
  row(-2, 3, 'fop'),
  row(-1, 3, 'ghm'),
  row(0, 2, 'pof'),
  row(1, 2, 'gh'),
);

export const theGreatCrossing: Scenario = {
  id: 'the-great-crossing',
  name: 'The Great Crossing',
  description:
    'Two continents, three hexes of open ocean between them, and two points for the first landing on the far shore.',
  minPlayers: 2,
  maxPlayers: 4,
  victoryPointsToWin: 14,
  expansions: SEAFARERS,
  islandBonus: { 1: 2 },
  build: (rng) => assembleBoard(MAP, rng, { seaMargin: 2, ports: 10, seafarers: true }),
};
