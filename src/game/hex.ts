/**
 * Hex geometry for a pointy-top axial grid.
 *
 * Vertices and edges are identified structurally rather than by position, which
 * keeps them exact (no float keys) and stable across board sizes:
 *
 *   - An edge is the boundary between exactly two adjacent hexes, so its id is
 *     the sorted pair of those hex keys.
 *   - A vertex is where exactly three mutually-adjacent hexes meet, so its id is
 *     the sorted triple.
 *
 * The hexes in an id may be off-board (a coastal vertex still has three
 * mathematical neighbours); that is fine, the id is still unique and canonical.
 */

export interface HexCoord {
  q: number;
  r: number;
}

/** Stable string key for a hex, e.g. "0,-2". */
export type HexKey = string;
/** Sorted pair of hex keys joined by "|". */
export type EdgeId = string;
/** Sorted triple of hex keys joined by "|". */
export type VertexId = string;

export const hexKey = (h: HexCoord): HexKey => `${h.q},${h.r}`;

export function parseHexKey(key: HexKey): HexCoord {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

/** Neighbour directions in clockwise order starting due east. */
export const DIRECTIONS: readonly HexCoord[] = [
  { q: 1, r: 0 }, // E
  { q: 0, r: 1 }, // SE
  { q: -1, r: 1 }, // SW
  { q: -1, r: 0 }, // W
  { q: 0, r: -1 }, // NW
  { q: 1, r: -1 }, // NE
];

export const neighbor = (h: HexCoord, dir: number): HexCoord => {
  const d = DIRECTIONS[((dir % 6) + 6) % 6];
  return { q: h.q + d.q, r: h.r + d.r };
};

export const neighbors = (h: HexCoord): HexCoord[] =>
  DIRECTIONS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));

export const hexEquals = (a: HexCoord, b: HexCoord): boolean =>
  a.q === b.q && a.r === b.r;

/** Cube distance between two hexes. */
export function hexDistance(a: HexCoord, b: HexCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

const joinSorted = (keys: HexKey[]): string => [...keys].sort().join('|');

export const makeEdgeId = (a: HexCoord, b: HexCoord): EdgeId =>
  joinSorted([hexKey(a), hexKey(b)]);

export const makeVertexId = (
  a: HexCoord,
  b: HexCoord,
  c: HexCoord,
): VertexId => joinSorted([hexKey(a), hexKey(b), hexKey(c)]);

export const edgeHexes = (id: EdgeId): HexCoord[] =>
  id.split('|').map(parseHexKey);

export const vertexHexes = (id: VertexId): HexCoord[] =>
  id.split('|').map(parseHexKey);

/** The six edges bordering a hex. */
export const hexEdges = (h: HexCoord): EdgeId[] =>
  DIRECTIONS.map((_, i) => makeEdgeId(h, neighbor(h, i)));

/**
 * The six vertices of a hex. Each is the meeting point of this hex and two
 * consecutive neighbours.
 */
export const hexVertices = (h: HexCoord): VertexId[] =>
  DIRECTIONS.map((_, i) => makeVertexId(h, neighbor(h, i), neighbor(h, i + 1)));

/** The three edges radiating from a vertex. */
export function vertexEdges(id: VertexId): EdgeId[] {
  const [a, b, c] = vertexHexes(id);
  return [makeEdgeId(a, b), makeEdgeId(a, c), makeEdgeId(b, c)];
}

/**
 * The two vertices at the ends of an edge: the two hexes adjacent to both of
 * the edge's hexes.
 */
export function edgeVertices(id: EdgeId): VertexId[] {
  const [a, b] = edgeHexes(id);
  const bNeighborKeys = new Set(neighbors(b).map(hexKey));
  return neighbors(a)
    .filter((n) => bNeighborKeys.has(hexKey(n)))
    .map((shared) => makeVertexId(a, b, shared));
}

/** The (up to three) vertices one edge away from this vertex. */
export function adjacentVertices(id: VertexId): VertexId[] {
  const out = new Set<VertexId>();
  for (const edge of vertexEdges(id)) {
    for (const v of edgeVertices(edge)) {
      if (v !== id) out.add(v);
    }
  }
  return [...out];
}

/** True when the edge touches the vertex. */
export const edgeTouchesVertex = (edge: EdgeId, vertex: VertexId): boolean =>
  vertexEdges(vertex).includes(edge);

/** The vertex at the far end of `edge` from `vertex`, if any. */
export function otherEndpoint(
  edge: EdgeId,
  vertex: VertexId,
): VertexId | undefined {
  return edgeVertices(edge).find((v) => v !== vertex);
}

// ---------------------------------------------------------------------------
// Rendering geometry
// ---------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

const SQRT3 = Math.sqrt(3);

/** Centre point of a hex in pixels, for pointy-top layout. */
export const hexToPixel = (h: HexCoord, size: number): Point => ({
  x: size * SQRT3 * (h.q + h.r / 2),
  y: size * 1.5 * h.r,
});

/** The six corner points of a hex outline, in drawing order. */
export function hexCorners(h: HexCoord, size: number): Point[] {
  const c = hexToPixel(h, size);
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i - 30);
    return { x: c.x + size * Math.cos(angle), y: c.y + size * Math.sin(angle) };
  });
}

const centroid = (points: Point[]): Point => ({
  x: points.reduce((s, p) => s + p.x, 0) / points.length,
  y: points.reduce((s, p) => s + p.y, 0) / points.length,
});

/** Pixel position of a vertex: the centroid of its three hexes. */
export const vertexToPixel = (id: VertexId, size: number): Point =>
  centroid(vertexHexes(id).map((h) => hexToPixel(h, size)));

/** Midpoint of an edge: the centroid of its two hexes. */
export const edgeToPixel = (id: EdgeId, size: number): Point =>
  centroid(edgeHexes(id).map((h) => hexToPixel(h, size)));

/** Rotation in degrees for drawing a road along an edge. */
export function edgeAngle(id: EdgeId, size: number): number {
  const [a, b] = edgeVertices(id).map((v) => vertexToPixel(v, size));
  if (!a || !b) return 0;
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

/** All hexes within `radius` of the origin, forming a hexagonal board. */
export function hexSpiral(radius: number): HexCoord[] {
  const out: HexCoord[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      out.push({ q, r });
    }
  }
  return out;
}
