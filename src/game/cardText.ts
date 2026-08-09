/**
 * What every card actually does, in plain words.
 *
 * Cities & Knights has twenty-four progress cards and nobody remembers them.
 * Showing "master merchant" and nothing else asks the player to have the rule
 * book open, which is exactly the friction this game is meant to avoid.
 *
 * Where the implementation is a simplification of the printed card, the text
 * describes *what this game does*, not what the box says — a description that
 * does not match the button is worse than none.
 */

import type { ImprovementTrack, ProgressCardKind } from './types';

export interface CardText {
  title: string;
  detail: string;
}

export const PROGRESS_CARD_TEXT: Record<ProgressCardKind, CardText> = {
  // --- trade (yellow) ---
  commercial_harbor: {
    title: 'Commercial Harbor',
    detail: 'Take one resource of your choice from the bank.',
  },
  master_merchant: {
    title: 'Master Merchant',
    detail: 'Take two cards at random from a player you choose.',
  },
  merchant: {
    title: 'Merchant',
    detail: 'Take one resource of your choice from the bank.',
  },
  merchant_fleet: {
    title: 'Merchant Fleet',
    detail: 'Take one resource of your choice from the bank.',
  },
  resource_monopoly: {
    title: 'Resource Monopoly',
    detail: 'Name a resource. Every other player gives you up to two of it.',
  },
  trade_monopoly: {
    title: 'Trade Monopoly',
    detail: 'Name a commodity. Every other player gives you one of it.',
  },

  // --- politics (blue) ---
  bishop: {
    title: 'Bishop',
    detail: 'Move the robber, then steal from someone next to its new hex.',
  },
  constitution: {
    title: 'Constitution',
    detail: 'Keep this card. It is worth one victory point, permanently.',
  },
  deserter: {
    title: 'Deserter',
    detail: 'Choose a player: one of their knights changes sides and joins you.',
  },
  diplomat: {
    title: 'Diplomat',
    detail: "Remove one of another player's roads from the board.",
  },
  intrigue: {
    title: 'Intrigue',
    detail:
      "Force an opponent's knight off its spot, back onto their own network.",
  },
  saboteur: {
    title: 'Saboteur',
    detail:
      'Every player with as many points as you discards half their hand.',
  },
  spy: {
    title: 'Spy',
    detail: 'Take a progress card at random from a player you choose.',
  },
  warlord: {
    title: 'Warlord',
    detail: 'Activate all of your knights at once, free of charge.',
  },
  wedding: {
    title: 'Wedding',
    detail: 'Every player ahead of you on points gives you two cards.',
  },

  // --- science (green) ---
  alchemist: {
    title: 'Alchemist',
    detail: 'Take one wool from the bank.',
  },
  crane: {
    title: 'Crane',
    detail: 'Take one lumber from the bank, towards a city improvement.',
  },
  engineer: {
    title: 'Engineer',
    detail: 'Take one ore from the bank, towards a city wall.',
  },
  inventor: {
    title: 'Inventor',
    detail: 'Swap the number tokens on two hexes.',
  },
  irrigation: {
    title: 'Irrigation',
    detail: 'Take two grain from the bank.',
  },
  medicine: {
    title: 'Medicine',
    detail: 'Take one brick from the bank, towards a city.',
  },
  mining: {
    title: 'Mining',
    detail: 'Take two ore from the bank.',
  },
  printer: {
    title: 'Printer',
    detail: 'Keep this card. It is worth one victory point, permanently.',
  },
  road_building: {
    title: 'Road Building',
    detail: 'Build two roads for free.',
  },
  smith: {
    title: 'Smith',
    detail: 'Take one ore from the bank, towards promoting a knight.',
  },
};

/** What each improvement track buys you, so the meters are not just bars. */
export const TRACK_TEXT: Record<ImprovementTrack, CardText> = {
  trade: {
    title: 'Trade (cloth)',
    detail:
      'Draws yellow progress cards. Level 4 earns a metropolis worth 2 points.',
  },
  politics: {
    title: 'Politics (coin)',
    detail:
      'Draws blue progress cards. Level 3 lets you promote knights to mighty; level 4 earns a metropolis worth 2 points.',
  },
  science: {
    title: 'Science (paper)',
    detail:
      'Draws green progress cards. Level 4 earns a metropolis worth 2 points.',
  },
};

export const COMMODITY_TEXT: Record<string, string> = {
  coin: 'Coin — produced by a city on mountains. Buys politics improvements.',
  paper: 'Paper — produced by a city on forest. Buys science improvements.',
  cloth: 'Cloth — produced by a city on pasture. Buys trade improvements.',
};

/** Title for a card kind, falling back to a readable version of the name. */
export const cardTitle = (kind: string): string =>
  PROGRESS_CARD_TEXT[kind as ProgressCardKind]?.title ??
  kind.replace(/_/g, ' ');

export const cardDetail = (kind: string): string =>
  PROGRESS_CARD_TEXT[kind as ProgressCardKind]?.detail ?? '';
