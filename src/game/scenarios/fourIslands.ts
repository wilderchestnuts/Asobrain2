/**
 * Seafarers 2 — Four Islands.
 *
 * Four islands of seven hexes, no home continent. Players start scattered, and
 * every island but the one they land on first is worth two points, so the map
 * is symmetric on purpose: nobody starts richer, only closer.
 */

import { assembleBoard, type Scenario } from '../board';
import { rows, row, SEAFARERS } from './common';

const MAP = rows(
  // north-west island, centred on (-3,-1)
  row(-2, -3, 'fp'),
  row(-1, -4, 'mgh'),
  row(0, -4, 'op'),
  // north-east island, centred on (2,-4)
  row(-5, 2, 'gh'),
  row(-4, 1, 'fmp'),
  row(-3, 1, 'og'),
  // south-west island, centred on (-1,4)
  row(3, -1, 'pm'),
  row(4, -2, 'fhg'),
  row(5, -2, 'of'),
  // south-east island, centred on (4,1)
  row(0, 4, 'hf'),
  row(1, 3, 'pdg'),
  row(2, 3, 'om'),
);

export const fourIslands: Scenario = {
  id: 'four-islands',
  name: 'Four Islands',
  description:
    'No mainland at all: four equal islands, one gold hex each, and two points for every island after your first.',
  minPlayers: 2,
  maxPlayers: 4,
  victoryPointsToWin: 13,
  expansions: SEAFARERS,
  islandBonus: { 1: 2, 2: 2, 3: 2 },
  build: (rng) => assembleBoard(MAP, rng, { seaMargin: 2, ports: 10, seafarers: true }),
};
