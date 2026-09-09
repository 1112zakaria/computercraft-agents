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
