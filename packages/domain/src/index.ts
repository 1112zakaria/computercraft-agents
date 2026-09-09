export const domainVersion = "0.1.0" as const;

export type WorkerStatus = "ONLINE" | "OFFLINE" | "STOPPED";

export interface WorkerSnapshot {
  readonly workerId: string;
  readonly computerId: number;
  readonly status: WorkerStatus;
  readonly lastHeartbeatAt: string | null;
}

export interface GatherResourceGoal {
  readonly targetWorkerId: string;
  readonly itemKey: string;
  readonly quantity: number;
  readonly destination: string;
}

export type AddressedGoalParseResult =
  | { readonly ok: true; readonly goal: GatherResourceGoal }
  | { readonly ok: false; readonly error: string };

/** Parse the deliberately narrow first useful-worker sentence into a deterministic goal. */
export function parseAddressedGatherGoal(input: string): AddressedGoalParseResult {
  const match =
    /^\s*@([A-Za-z0-9][A-Za-z0-9._:-]*)\s+get\s+(\d+)\s+([A-Za-z0-9._:-]+)\s+and\s+deposit\s+it\s+in\s+(.+?)\s*$/i.exec(
      input,
    );
  if (!match) {
    return {
      ok: false,
      error: "expected '@worker get <quantity> <item> and deposit it in <location>'",
    };
  }

  const quantity = Number(match[2]);
  const itemKey = normalizeItemKey(match[3]!);
  const destination = match[4]!.trim();
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 64) {
    return { ok: false, error: "quantity must be an integer between 1 and 64" };
  }
  if (!destination) return { ok: false, error: "destination must not be empty" };

  return {
    ok: true,
    goal: {
      targetWorkerId: match[1]!,
      itemKey,
      quantity,
      destination,
    },
  };
}

function normalizeItemKey(value: string): string {
  return value.includes(":") ? value : `minecraft:${value.toLowerCase()}`;
}
