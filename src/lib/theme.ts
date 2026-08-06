/**
 * Board palette, piece metrics and shared glyph paths.
 *
 * Colours live here as the single source of truth and are emitted as CSS custom
 * properties by `boardThemeCss()`, which `<Board>` injects once. Every accessor
 * returns `var(--asb-x, <light value>)`, so a component still paints correctly
 * during SSR or if it is rendered outside a Board — the variable only ever
 * *overrides* the baked-in light value.
 *
 * The player palette is picked for deuteranopia: the two warm seats are far
 * apart in lightness rather than hue, the two cool seats likewise, and every
 * piece also carries a per-player emblem and road dash pattern, so colour is
 * never the only signal.
 */

import type { ImprovementTrack, Terrain, Tradeable } from '@/game/types';

export interface ColorPair {
  light: string;
  dark: string;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export const TERRAIN_COLORS: Record<Terrain, ColorPair> = {
  hills: { light: '#C1683A', dark: '#8C4A28' },
  forest: { light: '#2E7D4F', dark: '#1D5636' },
  pasture: { light: '#8CC152', dark: '#527F30' },
  fields: { light: '#E6BE3E', dark: '#A98A24' },
  mountains: { light: '#8A90A2', dark: '#565C6E' },
  desert: { light: '#E3D3A4', dark: '#9C8D64' },
  sea: { light: '#2E80C4', dark: '#123E63' },
  gold: { light: '#F0AE18', dark: '#B98207' },
  fog: { light: '#A8B4C0', dark: '#495363' },
};

export const TERRAIN_LABEL: Record<Terrain, string> = {
  hills: 'Hills',
  forest: 'Forest',
  pasture: 'Pasture',
  fields: 'Fields',
  mountains: 'Mountains',
  desert: 'Desert',
  sea: 'Sea',
  gold: 'Gold field',
  fog: 'Fog',
};

// ---------------------------------------------------------------------------
// Surfaces, ink and affordances
// ---------------------------------------------------------------------------

export const SURFACE_COLORS = {
  'board-bg': { light: '#D9E9F6', dark: '#070C14' },
  'hex-edge': { light: 'rgba(15,23,42,0.40)', dark: 'rgba(226,232,240,0.32)' },
  ink: { light: '#12202F', dark: '#E7EDF5' },
  'ink-soft': { light: 'rgba(18,32,47,0.52)', dark: 'rgba(231,237,245,0.46)' },
  glyph: { light: 'rgba(12,22,33,0.34)', dark: 'rgba(6,12,20,0.42)' },
  'token-bg': { light: '#FBF6E7', dark: '#EFE9D8' },
  'token-ink': { light: '#1B2430', dark: '#141C26' },
  'token-hot': { light: '#C62828', dark: '#B01B1B' },
  'token-edge': { light: 'rgba(27,36,48,0.40)', dark: 'rgba(20,28,38,0.45)' },
  'port-bg': { light: '#F7EDD5', dark: '#DCCFAE' },
  'port-ink': { light: '#3A2E12', dark: '#241C08' },
  blocked: { light: 'rgba(8,14,24,0.34)', dark: 'rgba(0,0,0,0.48)' },
  robber: { light: '#1D1A17', dark: '#0B0A09' },
  'robber-rim': { light: '#F5F1E8', dark: '#B9B3A6' },
  highlight: { light: '#0E9A9A', dark: '#2AD3D3' },
  confirm: { light: '#12874F', dark: '#25C071' },
  'ghost-ink': { light: '#0F172A', dark: '#F8FAFC' },
} satisfies Record<string, ColorPair>;

export type SurfaceKey = keyof typeof SURFACE_COLORS;

export const TRACK_COLORS: Record<ImprovementTrack, ColorPair> = {
  trade: { light: '#E2A400', dark: '#FFC42E' },
  politics: { light: '#1668C4', dark: '#4C9BEF' },
  science: { light: '#009E73', dark: '#1FC79A' },
};

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export type PlayerEmblem =
  | 'circle'
  | 'triangle'
  | 'diamond'
  | 'star'
  | 'square'
  | 'cross';

export interface PlayerPalette {
  key: string;
  label: string;
  base: ColorPair;
  /** Outline / shadow tone: always darker than `base` in both schemes. */
  ink: ColorPair;
  /** Emblem and road-stripe tone: always lighter than `base`. */
  lite: ColorPair;
  emblem: PlayerEmblem;
  /** SVG stroke-dasharray for the accent stripe down a road. '' = solid. */
  dash: string;
}

export const PLAYER_PALETTE: readonly PlayerPalette[] = [
  {
    key: 'azure',
    label: 'Azure',
    base: { light: '#1668C4', dark: '#3E92EC' },
    ink: { light: '#0A3A70', dark: '#082140' },
    lite: { light: '#C4DFFA', dark: '#E1EFFF' },
    emblem: 'circle',
    dash: '',
  },
  {
    key: 'vermilion',
    label: 'Vermilion',
    base: { light: '#D2440E', dark: '#F0672B' },
    ink: { light: '#752606', dark: '#421202' },
    lite: { light: '#FBCCB2', dark: '#FFE3D2' },
    emblem: 'triangle',
    dash: '18 12',
  },
  {
    key: 'amber',
    label: 'Amber',
    base: { light: '#E2A400', dark: '#FFC42E' },
    ink: { light: '#7A5900', dark: '#463300' },
    lite: { light: '#FCEBB4', dark: '#FFF4D2' },
    emblem: 'diamond',
    dash: '4 10',
  },
  {
    key: 'violet',
    label: 'Violet',
    base: { light: '#8B45CE', dark: '#B27CEE' },
    ink: { light: '#4A2274', dark: '#2A1244' },
    lite: { light: '#DFC6F6', dark: '#F0E2FF' },
    emblem: 'star',
    dash: '22 8 4 8',
  },
  {
    key: 'teal',
    label: 'Teal',
    base: { light: '#009E73', dark: '#1FC79A' },
    ink: { light: '#00543D', dark: '#00291D' },
    lite: { light: '#ACE9D6', dark: '#D8F7EE' },
    emblem: 'square',
    dash: '10 10',
  },
  {
    key: 'slate',
    label: 'Slate',
    base: { light: '#4A5568', dark: '#96A3B8' },
    ink: { light: '#212936', dark: '#0F151E' },
    lite: { light: '#CBD3DF', dark: '#E7ECF3' },
    emblem: 'cross',
    dash: '2 8',
  },
];

/**
 * Engine-assigned colour names are plain words like "red". Map them onto the
 * safe palette rather than painting an actual red/green pair.
 */
const COLOR_ALIASES: Record<string, string> = {
  red: 'vermilion',
  orange: 'vermilion',
  brown: 'vermilion',
  blue: 'azure',
  cyan: 'azure',
  navy: 'azure',
  yellow: 'amber',
  gold: 'amber',
  purple: 'violet',
  magenta: 'violet',
  pink: 'violet',
  green: 'teal',
  emerald: 'teal',
  white: 'slate',
  black: 'slate',
  grey: 'slate',
  gray: 'slate',
};

/** A palette entry resolved to paint-ready CSS colour strings. */
export interface PlayerStyle {
  key: string;
  label: string;
  base: string;
  ink: string;
  lite: string;
  emblem: PlayerEmblem;
  dash: string;
}

const varOf = (name: string, fallback: string) => `var(--asb-${name}, ${fallback})`;

const paletteStyle = (p: PlayerPalette): PlayerStyle => ({
  key: p.key,
  label: p.label,
  base: varOf(`pl-${p.key}`, p.base.light),
  ink: varOf(`pl-${p.key}-ink`, p.ink.light),
  lite: varOf(`pl-${p.key}-lite`, p.lite.light),
  emblem: p.emblem,
  dash: p.dash,
});

/**
 * Resolve `Player.color` to a paint-ready style. Unknown values are treated as
 * raw CSS colours and derived from with `color-mix`, so a custom colour still
 * gets a matching outline and emblem tone.
 */
export function playerStyle(color: string | undefined, seat = 0): PlayerStyle {
  const key = color ? COLOR_ALIASES[color.toLowerCase()] ?? color.toLowerCase() : '';
  const hit = PLAYER_PALETTE.find((p) => p.key === key);
  if (hit) return paletteStyle(hit);
  if (!color) return paletteStyle(PLAYER_PALETTE[seat % PLAYER_PALETTE.length]);

  const fallback = PLAYER_PALETTE[seat % PLAYER_PALETTE.length];
  return {
    key: color,
    label: color,
    base: color,
    ink: `color-mix(in srgb, ${color} 55%, #000)`,
    lite: `color-mix(in srgb, ${color} 30%, #fff)`,
    emblem: fallback.emblem,
    dash: fallback.dash,
  };
}

/** Style per player id, keyed off the seat order for stable emblem fallbacks. */
export function playerStyles(
  players: readonly { id: string; color?: string }[] | undefined,
): Record<string, PlayerStyle> {
  const out: Record<string, PlayerStyle> = {};
  players?.forEach((p, i) => {
    out[p.id] = playerStyle(p.color, i);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Token accessors
// ---------------------------------------------------------------------------

export const terrainFill = (t: Terrain): string =>
  varOf(`terrain-${t}`, TERRAIN_COLORS[t].light);

export const surface = (k: SurfaceKey): string =>
  varOf(`s-${k}`, SURFACE_COLORS[k].light);

export const trackColor = (t: ImprovementTrack): string =>
  varOf(`track-${t}`, TRACK_COLORS[t].light);

// ---------------------------------------------------------------------------
// Generated stylesheet
// ---------------------------------------------------------------------------

function declarations(scheme: 'light' | 'dark'): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(TERRAIN_COLORS)) {
    out.push(`--asb-terrain-${k}:${v[scheme]}`);
  }
  for (const [k, v] of Object.entries(SURFACE_COLORS)) {
    out.push(`--asb-s-${k}:${v[scheme]}`);
  }
  for (const [k, v] of Object.entries(TRACK_COLORS)) {
    out.push(`--asb-track-${k}:${v[scheme]}`);
  }
  for (const p of PLAYER_PALETTE) {
    out.push(`--asb-pl-${p.key}:${p.base[scheme]}`);
    out.push(`--asb-pl-${p.key}-ink:${p.ink[scheme]}`);
    out.push(`--asb-pl-${p.key}-lite:${p.lite[scheme]}`);
  }
  return out.join(';');
}

/**
 * The whole palette as CSS. Emitted once by `<Board>`; `data-theme` on <html>
 * wins over the media query in both directions so a manual toggle can be added
 * later without touching this file.
 */
export function boardThemeCss(): string {
  const light = declarations('light');
  const dark = declarations('dark');
  return [
    `:root{${light}}`,
    `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark}}}`,
    `:root[data-theme="dark"]{${dark}}`,
    `:root[data-theme="light"]{${light}}`,
  ].join('');
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Hex side length in board-world units. The viewBox is fitted to the container,
 * so this is only a scale reference — every piece metric is a fraction of it.
 */
export const HEX_SIZE = 100;

/** Minimum tap target, in CSS pixels, per the iPad-first rule in CLAUDE.md. */
export const MIN_TAP_PX = 44;

// ---------------------------------------------------------------------------
// Shared glyph paths (24x24 box)
// ---------------------------------------------------------------------------

export const GLYPH_BOX = 24;

/** Single-path glyphs so they can be dropped straight into any <svg>. */
export const TRADEABLE_GLYPH: Record<Tradeable | 'any', string> = {
  brick:
    'M2.5 6h8.2v4.6H2.5zM12.3 6h9.2v4.6h-9.2zM2.5 12.2h6.4v4.6H2.5zM10.5 12.2h11v4.6h-11z',
  lumber:
    'M12 2.2l4.6 7.1h-2.5l3.7 5.9h-3.1v6.6h-5.4v-6.6H6.2l3.7-5.9H7.4z',
  wool:
    'M7.3 16.9a4.3 4.3 0 01-.6-8.5 3.9 3.9 0 015.9-2.3 4.1 4.1 0 016.2 3 4.1 4.1 0 01-1.9 7.8zM7.6 17.4h1.7v3.6H7.6zM14.7 17.4h1.7v3.6h-1.7z',
  grain:
    'M11.2 21.4V9.7h1.6v11.7zM12 2.6c2 1.7 2.6 3.7 2 5.6-1.5-.6-2.2-2.7-2-5.6zM12 2.6c-2 1.7-2.6 3.7-2 5.6 1.5-.6 2.2-2.7 2-5.6zM17.6 7.3c-.2 2.5-1.3 4.1-3.1 4.6-.2-1.6.9-3.3 3.1-4.6zM6.4 7.3c.2 2.5 1.3 4.1 3.1 4.6.2-1.6-.9-3.3-3.1-4.6zM17.9 12.6c-.2 2.5-1.3 4.1-3.1 4.6-.2-1.6.9-3.3 3.1-4.6zM6.1 12.6c.2 2.5 1.3 4.1 3.1 4.6.2-1.6-.9-3.3-3.1-4.6z',
  ore: 'M1.6 20.4l6.8-11.6 3.6 6.2 2.7-4.4 7.7 9.8z',
  coin:
    'M12 2a10 10 0 100 20 10 10 0 000-20zm0 4.4a5.6 5.6 0 110 11.2 5.6 5.6 0 010-11.2z',
  paper:
    'M6 2.2h7.6L18.2 6.8V21.8H6zM8.4 9.8h7.4v1.7H8.4zM8.4 13.5h7.4v1.7H8.4zM8.4 17.2h4.8v1.7H8.4z',
  cloth:
    'M4 5.2l4.1-2.1L12 5.2l3.9-2.1L20 5.2v4.3l-2.2 1.1v10.2H6.2V10.6L4 9.5z',
  any: 'M12 1.8l2.7 7.5 7.5 2.7-7.5 2.7-2.7 7.5-2.7-7.5L1.8 12l7.5-2.7z',
};

export const TRADEABLE_LABEL: Record<Tradeable | 'any', string> = {
  brick: 'Brick',
  lumber: 'Lumber',
  wool: 'Wool',
  grain: 'Grain',
  ore: 'Ore',
  coin: 'Coin',
  paper: 'Paper',
  cloth: 'Cloth',
  any: 'Any',
};
