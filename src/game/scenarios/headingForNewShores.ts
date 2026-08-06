/**
 * Seafarers 1 — Heading for New Shores.
 *
 * One crowded home island and three specks of land to the east, each with a
 * gold hex on it. Nothing forces you off the main island; the two victory
 * points per new shore do.
 */

import { assembleBoard, type Scenario } from '../board';
import { rows, row, SEAFARERS } from './common';

//        q →
//  r=-2        f p g
//  r=-1      m h f p            . . .   (5,-3) (6,-3)
//  r= 0    g d p m g            . . .   (5,-1) (6,-1)
//  r= 1    h f m h              . . .   (5, 0)
//  r= 2    p g f                . . .   (4, 2) (5,2) (4,3)
const MAP = rows(
  // main island
  row(-2, 0, 'fpg'),
  row(-1, -1, 'mhfp'),
  row(0, -2, 'gdpmg'),
  row(1, -2, 'hfmh'),
  row(2, -2, 'pgf'),
  // north-east islet
  row(-3, 5, 'of'),
  // east islet
  row(-1, 5, 'op'),
  row(0, 5, 'h'),
  // south-east islet
  row(2, 4, 'om'),
  row(3, 4, 'g'),
);

export const headingForNewShores: Scenario = {
  id: 'heading-for-new-shores',
  name: 'Heading for New Shores',
  description:
    'The home island is full. Three gold-bearing islets lie east — two points to whoever lands first.',
  minPlayers: 2,
  maxPlayers: 4,
  victoryPointsToWin: 14,
  expansions: SEAFARERS,
  islandBonus: { 1: 2, 2: 2, 3: 2 },
  build: (rng) => assembleBoard(MAP, rng, { seaMargin: 2, ports: 9, seafarers: true }),
};
