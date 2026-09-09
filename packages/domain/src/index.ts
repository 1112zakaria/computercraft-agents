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

export type GatherTaskPhase =
  | "CHECK_INVENTORY"
  | "GATHER"
  | "NAVIGATE_DESTINATION"
  | "DEPOSIT"
  | "VERIFY"
  | "COMPLETED"
  | "BLOCKED";

export interface GatherTaskState {
  readonly phase: GatherTaskPhase;
  readonly goal: GatherResourceGoal;
  readonly maxDepth: number;
  readonly collectedQuantity: number;
  readonly depositedQuantity: number;
  readonly blockedReason?: string;
}

export interface GatherActionObservation {
  readonly kind: "gather" | "navigate" | "deposit" | "verify";
  readonly status: "OK" | "BLOCKED" | "FAILED" | "TARGET_NOT_REACHED";
  readonly collectedQuantity?: number;
  readonly depositedQuantity?: number;
}

export interface GatherTaskObservation {
  readonly inventoryQuantity: number;
  readonly destinationKnown: boolean;
  readonly atDestination: boolean;
  readonly lastAction?: GatherActionObservation;
}

export type GatherTaskAction =
  | {
      readonly kind: "gather";
      readonly itemKey: string;
      readonly quantity: number;
      readonly maxDepth: number;
    }
  | { readonly kind: "navigate"; readonly destination: string }
  | {
      readonly kind: "deposit";
      readonly destination: string;
      readonly itemKey: string;
      readonly quantity: number;
    }
  | { readonly kind: "verify"; readonly destination: string; readonly quantity: number };

export interface GatherTaskTransition {
  readonly state: GatherTaskState;
  readonly action?: GatherTaskAction;
}

function blockedGatherTask(
  state: GatherTaskState,
  reason: string,
  observation: GatherTaskObservation,
): GatherTaskTransition {
  return {
    state: {
      ...state,
      phase: "BLOCKED",
      collectedQuantity: Math.max(state.collectedQuantity, observation.inventoryQuantity),
      blockedReason: reason,
    },
  };
}

/**
 * Advance the safe, bounded gather workflow by one deterministic step.
 * This is a pure planning contract; persistence and command dispatch remain control-plane work.
 */
export function advanceGatherTask(
  state: GatherTaskState,
  observation: GatherTaskObservation,
): GatherTaskTransition {
  const collectedQuantity = Math.max(state.collectedQuantity, observation.inventoryQuantity);
  const depositedQuantity = Math.max(
    state.depositedQuantity,
    observation.lastAction?.depositedQuantity ?? 0,
  );
  const current = { ...state, collectedQuantity, depositedQuantity };

  if (state.phase === "COMPLETED" || state.phase === "BLOCKED") {
    return { state: current };
  }

  if (state.phase === "CHECK_INVENTORY") {
    if (collectedQuantity < state.goal.quantity) {
      return {
        state: { ...current, phase: "GATHER" },
        action: {
          kind: "gather",
          itemKey: state.goal.itemKey,
          quantity: state.goal.quantity - collectedQuantity,
          maxDepth: state.maxDepth,
        },
      };
    }
    return {
      state: { ...current, phase: "NAVIGATE_DESTINATION" },
      action: { kind: "navigate", destination: state.goal.destination },
    };
  }

  if (state.phase === "GATHER") {
    if (collectedQuantity >= state.goal.quantity) {
      return {
        state: { ...current, phase: "NAVIGATE_DESTINATION" },
        action: { kind: "navigate", destination: state.goal.destination },
      };
    }
    if (observation.lastAction?.kind === "gather") {
      return blockedGatherTask(
        current,
        observation.lastAction.status === "TARGET_NOT_REACHED"
          ? "gather depth bound exhausted before reaching the requested quantity"
          : "gather action did not complete",
        observation,
      );
    }
    return {
      state: current,
      action: {
        kind: "gather",
        itemKey: state.goal.itemKey,
        quantity: state.goal.quantity - collectedQuantity,
        maxDepth: state.maxDepth,
      },
    };
  }

  if (state.phase === "NAVIGATE_DESTINATION") {
    if (!observation.destinationKnown) {
      return blockedGatherTask(current, "destination is not a known named location", observation);
    }
    if (!observation.atDestination) {
      if (observation.lastAction?.kind === "navigate") {
        return blockedGatherTask(current, "navigation did not reach the destination", observation);
      }
      return {
        state: current,
        action: { kind: "navigate", destination: state.goal.destination },
      };
    }
    return {
      state: { ...current, phase: "DEPOSIT" },
      action: {
        kind: "deposit",
        destination: state.goal.destination,
        itemKey: state.goal.itemKey,
        quantity: state.goal.quantity,
      },
    };
  }

  if (state.phase === "DEPOSIT") {
    if (observation.lastAction?.kind === "deposit") {
      if (observation.lastAction.status !== "OK") {
        return blockedGatherTask(current, "deposit action did not complete", observation);
      }
      return {
        state: { ...current, phase: "VERIFY" },
        action: {
          kind: "verify",
          destination: state.goal.destination,
          quantity: state.goal.quantity,
        },
      };
    }
    return {
      state: current,
      action: {
        kind: "deposit",
        destination: state.goal.destination,
        itemKey: state.goal.itemKey,
        quantity: state.goal.quantity,
      },
    };
  }

  if (state.depositedQuantity >= state.goal.quantity) {
    return { state: { ...current, phase: "COMPLETED" } };
  }
  if (observation.lastAction?.kind === "verify") {
    return blockedGatherTask(
      current,
      "delivery verification did not reach the requested quantity",
      observation,
    );
  }
  return {
    state: current,
    action: {
      kind: "verify",
      destination: state.goal.destination,
      quantity: state.goal.quantity,
    },
  };
}

export type AddressTarget =
  { readonly kind: "named"; readonly name: string } | { readonly kind: "all" };

export interface AddressedCommand {
  readonly targets: readonly AddressTarget[];
  readonly commandText: string;
}

export type AddressedCommandParseResult =
  | { readonly ok: true; readonly command: AddressedCommand }
  | { readonly ok: false; readonly error: string };

/** Parse explicit worker/group/all addressing before any natural-language interpretation. */
export function parseAddressedCommand(input: string): AddressedCommandParseResult {
  const match =
    /^\s*((?:@[A-Za-z0-9][A-Za-z0-9._:-]*)(?:\s*,\s*@[A-Za-z0-9][A-Za-z0-9._:-]*)*)\s+(.+?)\s*$/i.exec(
      input,
    );
  if (!match) {
    return {
      ok: false,
      error: "expected one or more explicit @worker, @group, or @all targets followed by a command",
    };
  }

  const names = match[1]!
    .split(",")
    .map((value) => value.trim().slice(1))
    .filter(Boolean);
  const normalizedNames = names.map((name) => name.toLowerCase());
  if (new Set(normalizedNames).size !== normalizedNames.length) {
    return { ok: false, error: "address targets must be unique" };
  }
  if (normalizedNames.includes("all") && normalizedNames.length > 1) {
    return { ok: false, error: "@all cannot be combined with named targets" };
  }

  return {
    ok: true,
    command: {
      targets:
        normalizedNames[0] === "all"
          ? [{ kind: "all" }]
          : names.map((name) => ({ kind: "named", name })),
      commandText: match[2]!,
    },
  };
}

export type AddressedGoalParseResult =
  | { readonly ok: true; readonly goal: GatherResourceGoal }
  | { readonly ok: false; readonly error: string };

/** Parse the deliberately narrow first useful-worker sentence into a deterministic goal. */
export function parseAddressedGatherGoal(input: string): AddressedGoalParseResult {
  const addressed = parseAddressedCommand(input);
  if (!addressed.ok || addressed.command.targets.length !== 1) {
    return {
      ok: false,
      error: "expected '@worker get <quantity> <item> and deposit it in <location>'",
    };
  }
  const target = addressed.command.targets[0];
  if (!target || target.kind !== "named") {
    return {
      ok: false,
      error: "the first useful gather goal requires exactly one named worker",
    };
  }
  const match = /^get\s+(\d+)\s+([A-Za-z0-9._:-]+)\s+and\s+deposit\s+it\s+in\s+(.+?)\s*$/i.exec(
    addressed.command.commandText,
  );
  if (!match) {
    return {
      ok: false,
      error: "expected '@worker get <quantity> <item> and deposit it in <location>'",
    };
  }

  const quantity = Number(match[1]);
  const itemKey = normalizeItemKey(match[2]!);
  const destination = match[3]!.trim();
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 64) {
    return { ok: false, error: "quantity must be an integer between 1 and 64" };
  }
  if (!destination) return { ok: false, error: "destination must not be empty" };

  return {
    ok: true,
    goal: {
      targetWorkerId: target.name,
      itemKey,
      quantity,
      destination,
    },
  };
}

/** Convert a user-facing bare item name to the canonical Minecraft ID. */
export function normalizeItemKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.includes(":") ? normalized : `minecraft:${normalized}`;
}
