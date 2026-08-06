/**
 * Seafarers 4 — Through the Desert.
 *
 * The home island ends in a dead strip of desert. Everything worth having is
 * on the far side of it: three small islands, each with gold, each worth two
 * points to the first player who reaches them by land or by sea.
 */

import { assembleBoard, type Scenario } from '../board';
import { rows, row, SEAFARERS } from './common';

const MAP = rows(
  // home island
  row(-2, -2, 'fpg'),
  row(-1, -3, 'mhfp'),
  row(0, -3, 'gpmh'),
  row(1, -3, 'fgm'),
  row(2, -3, 'ph'),
  // the desert strip along its eastern edge
  row(-2, 1, 'd'),
  row(-1, 1, 'd'),
  row(0, 1, 'd'),
  row(1, 1, 'd'),
  // beyond the desert
  row(-3, 3, 'og'),
  row(-2, 3, 'f'),
  row(-1, 4, 'op'),
  row(0, 4, 'h'),
  row(2, 3, 'om'),
  row(3, 3, 'g'),
);

export const throughTheDesert: Scenario = {
  id: 'through-the-desert',
  name: 'Through the Desert',
  description:
    'A wall of desert seals off the eastern coast. Cross it, or sail around it, to reach three gold islands.',
  minPlayers: 2,
  maxPlayers: 4,
  victoryPointsToWin: 14,
  expansions: SEAFARERS,
  islandBonus: { 1: 2, 2: 2, 3: 2 },
  build: (rng) => assembleBoard(MAP, rng, { seaMargin: 2, ports: 9, seafarers: true }),
};
