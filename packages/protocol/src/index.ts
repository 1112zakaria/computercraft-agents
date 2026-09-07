import { z } from "zod";

export const protocolVersion = 1 as const;

export const ProtocolVersionSchema = z.literal(protocolVersion);
export const IdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const TimestampSchema = z.string().datetime({ offset: true });
export const NonNegativeIntegerSchema = z.number().int().nonnegative();
export const PositiveIntegerSchema = z.number().int().positive();

export const ProtocolEnvelopeSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    messageId: IdentifierSchema,
    sentAt: TimestampSchema,
  })
  .strict();

export type ProtocolEnvelope = z.infer<typeof ProtocolEnvelopeSchema>;

export const DirectionSchema = z.enum(["N", "E", "S", "W", "UP", "DOWN"]);
export const RelativeDirectionSchema = z.enum(["front", "up", "down"]);
export const FacingSchema = z.enum(["N", "E", "S", "W"]);
export const PositionConfidenceSchema = z.enum(["CONFIRMED", "ESTIMATED", "UNCERTAIN"]);

export const PositionSchema = z
  .object({
    dimension: z.number().int(),
    x: z.number().int(),
    y: z.number().int(),
    z: z.number().int(),
    facing: FacingSchema,
    confidence: PositionConfidenceSchema,
  })
  .strict();

export const CapabilityMaturitySchema = z.enum([
  "UNIMPLEMENTED",
  "EXPERIMENTAL",
  "CANARY",
  "STABLE",
  "DISABLED",
]);

export const CapabilityNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);

export const CapabilityAdvertisementSchema = z
  .object({
    name: CapabilityNameSchema,
    version: z.string().min(1).max(32),
    maturity: CapabilityMaturitySchema,
  })
  .strict();

export const CapabilitySchema = z.union([CapabilityNameSchema, CapabilityAdvertisementSchema]);
export const CapabilitiesSchema = z.array(CapabilitySchema).max(256);

export type Capability = z.infer<typeof CapabilitySchema>;

export const WorkerStatusSchema = z.enum(["ONLINE", "OFFLINE", "STOPPED"]);
export const WorkerExecutionStateSchema = z.enum([
  "BOOTING",
  "REGISTERING",
  "IDLE",
  "EXECUTING",
  "PAUSED",
  "BLOCKED",
  "FAULTED",
]);

export const WorkerRegistrationSchema = z
  .object({
    workerId: IdentifierSchema,
    computerId: NonNegativeIntegerSchema,
    runtimeVersion: z.string().min(1).max(64),
    capabilities: CapabilitiesSchema,
  })
  .strict();

export const FuelSummarySchema = z
  .object({
    level: NonNegativeIntegerSchema.nullable().optional(),
    unlimited: z.boolean(),
    reserve: NonNegativeIntegerSchema,
  })
  .strict();

export const WorkerHeartbeatSchema = z
  .object({
    workerId: IdentifierSchema,
    computerId: NonNegativeIntegerSchema,
    workerBootId: IdentifierSchema,
    runtimeVersion: z.string().min(1).max(64),
    status: WorkerStatusSchema,
    executionState: WorkerExecutionStateSchema,
    capabilities: CapabilitiesSchema,
    lastSeenAt: TimestampSchema,
    currentCommandId: IdentifierSchema.nullable().optional(),
    position: PositionSchema.nullable().optional(),
    fuel: FuelSummarySchema.nullable().optional(),
  })
  .strict();

export type WorkerRegistration = z.infer<typeof WorkerRegistrationSchema>;
export type WorkerHeartbeat = z.infer<typeof WorkerHeartbeatSchema>;

export const GatewayRegistrationSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    gatewayId: IdentifierSchema,
    bootId: IdentifierSchema,
    minecraftServerId: IdentifierSchema,
    runtimeVersion: z.string().min(1).max(64).optional(),
    capabilities: CapabilitiesSchema.default([]),
    workers: z.array(WorkerRegistrationSchema).max(64),
  })
  .strict();

export const GatewayStatusSchema = z.enum(["ONLINE", "DEGRADED"]);

export const GatewayHeartbeatSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    gatewayId: IdentifierSchema,
    bootId: IdentifierSchema,
    sentAt: TimestampSchema,
    uptimeSeconds: NonNegativeIntegerSchema,
    status: GatewayStatusSchema,
    workers: z.array(WorkerHeartbeatSchema).max(64),
  })
  .strict();

export type GatewayRegistration = z.infer<typeof GatewayRegistrationSchema>;
export type GatewayHeartbeat = z.infer<typeof GatewayHeartbeatSchema>;

export const CommandBudgetSchema = z
  .object({
    maxPrimitives: PositiveIntegerSchema.max(1_000_000),
    maxBlockChanges: NonNegativeIntegerSchema.max(1_000_000),
    maxInventoryTransfers: NonNegativeIntegerSchema.max(100_000).optional(),
    maxDurationMs: PositiveIntegerSchema.max(86_400_000).optional(),
  })
  .strict();

const ItemKeySchema = IdentifierSchema;
const SlotSchema = z.number().int().min(1).max(16);
const QuantitySchema = PositiveIntegerSchema.max(64);

export const SkillNameSchema = z.enum([
  "movement.step",
  "navigate.path",
  "observation.block",
  "inventory.inspect",
  "inventory.deposit",
  "inventory.withdraw",
  "mining.excavate",
  "fuel.refuel",
]);

const MovementStepArgumentsSchema = z
  .object({
    direction: DirectionSchema,
  })
  .strict();

const NavigatePathArgumentsSchema = z
  .object({
    steps: z.array(DirectionSchema).min(1).max(1024),
  })
  .strict();

const ObservationBlockArgumentsSchema = z
  .object({
    direction: RelativeDirectionSchema,
  })
  .strict();

const EmptyArgumentsSchema = z.object({}).strict();

const InventoryDepositArgumentsSchema = z
  .object({
    containerId: IdentifierSchema.optional(),
    quantity: QuantitySchema.optional(),
    slot: SlotSchema.optional(),
  })
  .strict();

const InventoryWithdrawArgumentsSchema = z
  .object({
    containerId: IdentifierSchema.optional(),
    itemKey: ItemKeySchema,
    quantity: QuantitySchema,
    slot: SlotSchema.optional(),
  })
  .strict();

const MiningExcavateArgumentsSchema = z
  .object({
    width: PositiveIntegerSchema.max(64),
    height: PositiveIntegerSchema.max(64),
    depth: PositiveIntegerSchema.max(64),
  })
  .strict();

const FuelRefuelArgumentsSchema = z
  .object({
    maxItems: PositiveIntegerSchema.max(16),
  })
  .strict();

const commandBaseShape = {
  protocolVersion: ProtocolVersionSchema,
  commandId: IdentifierSchema,
  workerId: IdentifierSchema,
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  budget: CommandBudgetSchema,
};

const CommandUnionSchema = z.discriminatedUnion("skill", [
  z
    .object({
      ...commandBaseShape,
      skill: z.literal("movement.step"),
      arguments: MovementStepArgumentsSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseShape,
      skill: z.literal("navigate.path"),
      arguments: NavigatePathArgumentsSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseShape,
      skill: z.literal("observation.block"),
      arguments: ObservationBlockArgumentsSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseShape,
      skill: z.literal("inventory.inspect"),
      arguments: EmptyArgumentsSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseShape,
      skill: z.literal("inventory.deposit"),
      arguments: InventoryDepositArgumentsSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseShape,
      skill: z.literal("inventory.withdraw"),
      arguments: InventoryWithdrawArgumentsSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseShape,
      skill: z.literal("mining.excavate"),
      arguments: MiningExcavateArgumentsSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseShape,
      skill: z.literal("fuel.refuel"),
      arguments: FuelRefuelArgumentsSchema,
    })
    .strict(),
]);

export const CommandSchema = CommandUnionSchema.superRefine((command, context) => {
  if (Date.parse(command.expiresAt) <= Date.parse(command.issuedAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "expiresAt must be later than issuedAt",
    });
  }
});

export type SkillName = z.infer<typeof SkillNameSchema>;
export type CommandBudget = z.infer<typeof CommandBudgetSchema>;
export type Command = z.infer<typeof CommandSchema>;

const StopControlBaseShape = {
  protocolVersion: ProtocolVersionSchema,
  controlId: IdentifierSchema,
  issuedAt: TimestampSchema,
  reason: z.string().min(1).max(512).optional(),
};

export const WorkerStopControlSchema = z
  .object({
    ...StopControlBaseShape,
    type: z.literal("worker.stop"),
    workerId: IdentifierSchema,
  })
  .strict();

export const GlobalStopControlSchema = z
  .object({
    ...StopControlBaseShape,
    type: z.literal("all.stop"),
  })
  .strict();

export const StopControlSchema = z.union([WorkerStopControlSchema, GlobalStopControlSchema]);

export type WorkerStopControl = z.infer<typeof WorkerStopControlSchema>;
export type GlobalStopControl = z.infer<typeof GlobalStopControlSchema>;
export type StopControl = z.infer<typeof StopControlSchema>;

export const CommandPollResponseSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    serverTime: TimestampSchema,
    commands: z.array(CommandSchema).max(128),
    nextCursor: IdentifierSchema.nullable(),
    stopControls: z.array(StopControlSchema).max(128).default([]),
  })
  .strict();

export type CommandPollResponse = z.infer<typeof CommandPollResponseSchema>;

export const ProtocolErrorCodeSchema = z.enum([
  "INVALID_PAYLOAD",
  "UNSUPPORTED_PROTOCOL_VERSION",
  "UNKNOWN_WORKER",
  "UNKNOWN_SKILL",
  "INVALID_ARGUMENTS",
  "COMMAND_EXPIRED",
  "CAPABILITY_NOT_ENABLED",
  "DUPLICATE_MESSAGE",
  "AUTHENTICATION_FAILED",
  "INTERNAL_ERROR",
]);

export const ErrorBodySchema = z
  .object({
    code: ProtocolErrorCodeSchema,
    message: z.string().min(1).max(512),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const ErrorResponseSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    requestId: IdentifierSchema.nullable().optional(),
    error: ErrorBodySchema,
  })
  .strict();

export type ProtocolErrorCode = z.infer<typeof ProtocolErrorCodeSchema>;
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

const EventBaseShape = {
  protocolVersion: ProtocolVersionSchema,
  eventId: IdentifierSchema,
  gatewayId: IdentifierSchema,
  workerId: IdentifierSchema.nullable().optional(),
  commandId: IdentifierSchema.nullable().optional(),
  sequence: NonNegativeIntegerSchema,
  occurredAt: TimestampSchema,
};

const WorkerOnlinePayloadSchema = z
  .object({
    workerBootId: IdentifierSchema,
    computerId: NonNegativeIntegerSchema,
    runtimeVersion: z.string().min(1).max(64),
    capabilities: CapabilitiesSchema,
  })
  .strict();

const WorkerOfflinePayloadSchema = z
  .object({
    workerBootId: IdentifierSchema,
    reason: z.string().min(1).max(512).optional(),
  })
  .strict();

const WorkerStatePayloadSchema = z
  .object({
    state: WorkerExecutionStateSchema,
    position: PositionSchema.nullable(),
    fuel: FuelSummarySchema.nullable(),
    currentCommandId: IdentifierSchema.nullable(),
  })
  .strict();

const CommandAcceptedPayloadSchema = z
  .object({
    skill: SkillNameSchema,
  })
  .strict();

const CommandStartedPayloadSchema = CommandAcceptedPayloadSchema;

const CommandProgressPayloadSchema = z
  .object({
    completedPrimitives: NonNegativeIntegerSchema,
    message: z.string().max(512).optional(),
    position: PositionSchema.optional(),
  })
  .strict();

const CommandCompletedPayloadSchema = z
  .object({
    result: z.record(z.string(), z.unknown()).optional(),
    position: PositionSchema.optional(),
  })
  .strict();

const CommandFailedPayloadSchema = z
  .object({
    error: ErrorBodySchema,
    position: PositionSchema.optional(),
  })
  .strict();

const CommandCancelledPayloadSchema = z
  .object({
    reason: z.string().min(1).max(512),
  })
  .strict();

const MovementBlockedPayloadSchema = z
  .object({
    direction: DirectionSchema,
    reason: z.string().min(1).max(256),
    position: PositionSchema.optional(),
  })
  .strict();

const FuelLowPayloadSchema = z
  .object({
    fuelLevel: NonNegativeIntegerSchema,
    threshold: NonNegativeIntegerSchema,
  })
  .strict();

const FuelEmptyPayloadSchema = z
  .object({
    fuelLevel: z.literal(0),
  })
  .strict();

const InventoryStackSchema = z
  .object({
    slot: SlotSchema,
    itemKey: ItemKeySchema,
    count: PositiveIntegerSchema.max(64),
  })
  .strict();

const InventoryChangedPayloadSchema = z
  .object({
    slots: z.array(InventoryStackSchema).max(16),
  })
  .strict();

const InventoryFullPayloadSchema = z
  .object({
    freeSlots: z.number().int().min(0).max(16),
  })
  .strict();

const BlockObservedPayloadSchema = z
  .object({
    direction: RelativeDirectionSchema,
    block: z
      .object({
        name: z.string().min(1).max(256),
        metadata: z.number().int().nonnegative().optional(),
      })
      .strict()
      .nullable(),
    position: PositionSchema.optional(),
  })
  .strict();

const PeripheralObservedPayloadSchema = z
  .object({
    side: z.enum(["top", "bottom", "front", "back", "left", "right"]),
    type: IdentifierSchema,
    methods: z.array(z.string().min(1).max(128)).max(256),
  })
  .strict();

const ProtocolErrorPayloadSchema = z
  .object({
    code: ProtocolErrorCodeSchema,
    message: z.string().min(1).max(512),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const event = <T extends z.ZodTypeAny>(type: string, payload: T) =>
  z
    .object({
      ...EventBaseShape,
      type: z.literal(type),
      payload,
    })
    .strict();

const EventUnionSchema = z.discriminatedUnion("type", [
  event("worker.online", WorkerOnlinePayloadSchema),
  event("worker.offline", WorkerOfflinePayloadSchema),
  event("worker.state", WorkerStatePayloadSchema),
  event("command.accepted", CommandAcceptedPayloadSchema),
  event("command.started", CommandStartedPayloadSchema),
  event("command.progress", CommandProgressPayloadSchema),
  event("command.completed", CommandCompletedPayloadSchema),
  event("command.failed", CommandFailedPayloadSchema),
  event("command.cancelled", CommandCancelledPayloadSchema),
  event("movement.blocked", MovementBlockedPayloadSchema),
  event("fuel.low", FuelLowPayloadSchema),
  event("fuel.empty", FuelEmptyPayloadSchema),
  event("inventory.changed", InventoryChangedPayloadSchema),
  event("inventory.full", InventoryFullPayloadSchema),
  event("block.observed", BlockObservedPayloadSchema),
  event("peripheral.observed", PeripheralObservedPayloadSchema),
  event("protocol.error", ProtocolErrorPayloadSchema),
]);

export const EventSchema = EventUnionSchema.superRefine((eventValue, context) => {
  if (eventValue.type !== "protocol.error" && !eventValue.workerId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["workerId"],
      message: "workerId is required for worker events",
    });
  }

  const commandEvent =
    eventValue.type.startsWith("command.") ||
    ["movement.blocked", "fuel.low", "fuel.empty", "inventory.changed", "inventory.full"].includes(
      eventValue.type,
    );

  if (commandEvent && !eventValue.commandId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["commandId"],
      message: "commandId is required for command execution events",
    });
  }
});

export type Event = z.infer<typeof EventSchema>;

export const EventBatchSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    gatewayId: IdentifierSchema,
    bootId: IdentifierSchema,
    batchId: IdentifierSchema,
    events: z.array(EventSchema).min(1).max(256),
  })
  .strict();

export const EventAckSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    gatewayId: IdentifierSchema,
    bootId: IdentifierSchema,
    acceptedEventIds: z.array(IdentifierSchema).max(256),
  })
  .strict();

export type EventBatch = z.infer<typeof EventBatchSchema>;
export type EventAck = z.infer<typeof EventAckSchema>;

export function parseProtocolPayload<T>(schema: z.ZodType<T>, input: unknown): T {
  return schema.parse(input);
}

export function isSupportedProtocolVersion(input: unknown): input is typeof protocolVersion {
  return input === protocolVersion;
}
