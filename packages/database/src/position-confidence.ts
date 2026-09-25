// The wire vocabulary predates the database's more descriptive stored values.
export function storedPositionConfidence(value: string | undefined): string | null {
  if (value === undefined) return null;
  const values: Record<string, string> = {
    CONFIRMED: "CONFIRMED_ANCHOR",
    ESTIMATED: "DEAD_RECKONED",
    UNCERTAIN: "UNKNOWN",
  };
  return values[value] ?? value;
}

export interface PositionEvidence {
  readonly dimension?: number | null;
  readonly x?: number | null;
  readonly y?: number | null;
  readonly z?: number | null;
  readonly confidence?: string | null;
}

/**
 * Preserve an operator anchor across a telemetry heartbeat only when the
 * turtle reports the exact same coordinate. A heartbeat with a different
 * coordinate must remain unconfirmed until the operator anchors the worker
 * again; this keeps route planning conservative after manual relocation.
 */
export function effectivePositionConfidence(
  latest: PositionEvidence,
  anchor?: PositionEvidence | null,
): string | null {
  if (latest.confidence === "CONFIRMED_ANCHOR") return latest.confidence;
  if (
    anchor?.confidence === "CONFIRMED_ANCHOR" &&
    latest.dimension !== null &&
    latest.dimension !== undefined &&
    latest.x !== null &&
    latest.x !== undefined &&
    latest.y !== null &&
    latest.y !== undefined &&
    latest.z !== null &&
    latest.z !== undefined &&
    latest.dimension === anchor.dimension &&
    latest.x === anchor.x &&
    latest.y === anchor.y &&
    latest.z === anchor.z
  ) {
    return "CONFIRMED_ANCHOR";
  }
  return latest.confidence ?? null;
}
