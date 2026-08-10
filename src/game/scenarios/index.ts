/**
 * The board presets, keyed by the id stored in `GameOptions.scenario`.
 *
 * `random` is the plain generated board; everything else is Seafarers, where
 * the map is the scenario and the victory condition travels with it.
 */

import { generateBoard, type Scenario } from '../board';
import type { Rng } from '../rng';
import type { Board, GameOptions } from '../types';
import { longChain, sixIslands, splitContinent } from './archipelago';
import { fogIslands } from './fogIslands';
import { fourIslands } from './fourIslands';
import { goldenFog } from './goldenFog';
import { headingForNewShores } from './headingForNewShores';
import { theGreatCrossing } from './theGreatCrossing';
import { throughTheDesert } from './throughTheDesert';

export type { Scenario } from '../board';

/** Only the board-shaping fields matter here; the rest never reach the map. */
const RANDOM_DEFAULTS: GameOptions = {
  expansions: { seafarers: false, citiesAndKnights: false },
  victoryPointsToWin: 10,
  scenario: 'random',
  boardRadius: 2,
  goldHexCount: 0,
  handLimit: 7,
  seed: '',
  turnTimeLimit: 0,
  friendlyRobber: false,
};

export const randomScenario: Scenario = {
  id: 'random',
  name: 'Random Island',
  description:
    'The classic 19-hex island, shuffled fresh — balanced numbers, nine ports, one desert.',
  minPlayers: 2,
  maxPlayers: 4,
  victoryPointsToWin: 10,
  expansions: { seafarers: false, citiesAndKnights: false },
  build: (rng) => generateBoard(RANDOM_DEFAULTS, rng),
};

export const SCENARIOS: Record<string, Scenario> = {
  [randomScenario.id]: randomScenario,
  [headingForNewShores.id]: headingForNewShores,
  [fourIslands.id]: fourIslands,
  [fogIslands.id]: fogIslands,
  [throughTheDesert.id]: throughTheDesert,
  [theGreatCrossing.id]: theGreatCrossing,
  [goldenFog.id]: goldenFog,
  [sixIslands.id]: sixIslands,
  [longChain.id]: longChain,
  [splitContinent.id]: splitContinent,
};

export const getScenario = (id: string): Scenario | undefined => SCENARIOS[id];

/**
 * The board a game should start with. Presets are hand-drawn maps, so they
 * ignore `boardRadius`/`goldHexCount`; only `random` reads them.
 */
export function boardForOptions(options: GameOptions, rng: Rng): Board {
  const scenario = getScenario(options.scenario);
  return scenario && scenario.id !== randomScenario.id
    ? scenario.build(rng)
    : generateBoard(options, rng);
}
