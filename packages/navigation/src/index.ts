export const navigationVersion = "0.1.0" as const;

export type AxisDirection = "N" | "E" | "S" | "W" | "UP" | "DOWN";

export interface Coordinate {
  readonly dimension: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface WorldCell extends Coordinate {
  readonly walkable: boolean;
  readonly observedAt: string;
  readonly source: string;
}

export interface PathSearchOptions {
  readonly maxNodes?: number;
}

export interface PathResult {
  readonly coordinates: readonly Coordinate[];
  readonly directions: readonly AxisDirection[];
  readonly expandedNodes: number;
}

export type LocationConfidence = "CONFIRMED_ANCHOR" | "DEAD_RECKONED" | "SUSPECT" | "UNKNOWN";

export interface NamedLocation {
  readonly name: string;
  readonly coordinate: Coordinate;
  readonly facing?: "N" | "E" | "S" | "W";
  readonly confidence: LocationConfidence;
  readonly source: string;
  readonly observedAt: string;
}

/** In-memory location index used by planners and simulations before DB persistence is wired. */
export class NamedLocationRegistry {
  private readonly locations = new Map<string, NamedLocation>();

  public upsert(location: NamedLocation): void {
    const key = normalizeLocationName(location.name);
    if (!key) throw new Error("location name must not be empty");
    this.locations.set(key, { ...location, name: location.name.trim() });
  }

  public resolve(name: string): NamedLocation | undefined {
    return this.locations.get(normalizeLocationName(name));
  }

  public list(): readonly NamedLocation[] {
    return [...this.locations.values()].sort((left, right) => left.name.localeCompare(right.name));
  }
}

function normalizeLocationName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export class SparseWorldModel {
  private readonly cells = new Map<string, WorldCell>();

  public setCell(cell: WorldCell): void {
    this.cells.set(coordinateKey(cell), { ...cell });
  }

  public getCell(coordinate: Coordinate): WorldCell | undefined {
    return this.cells.get(coordinateKey(coordinate));
  }

  public isKnownWalkable(coordinate: Coordinate): boolean {
    return this.getCell(coordinate)?.walkable === true;
  }

  public size(): number {
    return this.cells.size;
  }
}

export function coordinateKey(coordinate: Coordinate): string {
  return `${coordinate.dimension}:${coordinate.x}:${coordinate.y}:${coordinate.z}`;
}

function sameCoordinate(left: Coordinate, right: Coordinate): boolean {
  return coordinateKey(left) === coordinateKey(right);
}

function manhattanDistance(left: Coordinate, right: Coordinate): number {
  if (left.dimension !== right.dimension) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) + Math.abs(left.z - right.z);
}

const neighborSteps: readonly { direction: AxisDirection; delta: Coordinate }[] = [
  { direction: "N", delta: { dimension: 0, x: 0, y: 0, z: -1 } },
  { direction: "E", delta: { dimension: 0, x: 1, y: 0, z: 0 } },
  { direction: "S", delta: { dimension: 0, x: 0, y: 0, z: 1 } },
  { direction: "W", delta: { dimension: 0, x: -1, y: 0, z: 0 } },
  { direction: "UP", delta: { dimension: 0, x: 0, y: 1, z: 0 } },
  { direction: "DOWN", delta: { dimension: 0, x: 0, y: -1, z: 0 } },
];

function neighbors(
  coordinate: Coordinate,
): readonly { coordinate: Coordinate; direction: AxisDirection }[] {
  return neighborSteps.map(({ direction, delta }) => ({
    direction,
    coordinate: {
      dimension: coordinate.dimension + delta.dimension,
      x: coordinate.x + delta.x,
      y: coordinate.y + delta.y,
      z: coordinate.z + delta.z,
    },
  }));
}

interface OpenNode {
  readonly coordinate: Coordinate;
  readonly score: number;
  readonly cost: number;
}

function popBest(open: OpenNode[]): OpenNode | undefined {
  open.sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score;
    if (left.cost !== right.cost) return left.cost - right.cost;
    return coordinateKey(left.coordinate).localeCompare(coordinateKey(right.coordinate));
  });
  return open.shift();
}

function reconstructPath(
  cameFrom: Map<string, { previous: Coordinate; direction: AxisDirection }>,
  start: Coordinate,
  goal: Coordinate,
): PathResult {
  const coordinates: Coordinate[] = [];
  const directions: AxisDirection[] = [];
  let current = goal;
  while (!sameCoordinate(current, start)) {
    coordinates.push(current);
    const edge = cameFrom.get(coordinateKey(current));
    if (!edge) {
      throw new Error("path reconstruction failed");
    }
    directions.push(edge.direction);
    current = edge.previous;
  }
  coordinates.reverse();
  directions.reverse();
  return { coordinates, directions, expandedNodes: 0 };
}

/** Find a path using only observed walkable cells. Unknown cells are never entered. */
export function findKnownPath(
  world: SparseWorldModel,
  start: Coordinate,
  goal: Coordinate,
  options: PathSearchOptions = {},
): PathResult | undefined {
  if (!world.isKnownWalkable(start) || !world.isKnownWalkable(goal)) return undefined;
  if (start.dimension !== goal.dimension) return undefined;

  const maxNodes = options.maxNodes ?? 10_000;
  const open: OpenNode[] = [{ coordinate: start, score: manhattanDistance(start, goal), cost: 0 }];
  const costs = new Map<string, number>([[coordinateKey(start), 0]]);
  const cameFrom = new Map<string, { previous: Coordinate; direction: AxisDirection }>();
  let expandedNodes = 0;

  while (open.length > 0 && expandedNodes < maxNodes) {
    const current = popBest(open);
    if (!current) break;
    expandedNodes += 1;
    if (sameCoordinate(current.coordinate, goal)) {
      const result = reconstructPath(cameFrom, start, goal);
      return { ...result, expandedNodes };
    }

    for (const next of neighbors(current.coordinate)) {
      if (!world.isKnownWalkable(next.coordinate)) continue;
      const key = coordinateKey(next.coordinate);
      const nextCost = current.cost + 1;
      if (nextCost >= (costs.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      costs.set(key, nextCost);
      cameFrom.set(key, { previous: current.coordinate, direction: next.direction });
      open.push({
        coordinate: next.coordinate,
        cost: nextCost,
        score: nextCost + manhattanDistance(next.coordinate, goal),
      });
    }
  }
  return undefined;
}
