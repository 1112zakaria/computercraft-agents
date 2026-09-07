import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import {
  CommandPollResponseSchema,
  ErrorResponseSchema,
  EventAckSchema,
  EventBatchSchema,
  GatewayHeartbeatSchema,
  GatewayRegistrationSchema,
  IdentifierSchema,
} from "@computercraft-agents/protocol";
import type {
  CommandPollResponse,
  EventAck,
  EventBatch,
  GatewayHeartbeat,
  GatewayRegistration,
} from "@computercraft-agents/protocol";
import { RepositoryError } from "@computercraft-agents/database";
import type { GatewayPollResult, GatewayRuntimeRepository } from "@computercraft-agents/database";
import type { z } from "zod";

export interface GatewayServiceConfig {
  readonly bearerSecret: string;
}

type GatewayRegistrationPayload = Omit<GatewayRegistration, "capabilities"> & {
  readonly capabilities?: GatewayRegistration["capabilities"];
};

export interface GatewayServiceStore {
  register(payload: GatewayRegistrationPayload): Promise<unknown>;
  heartbeat(payload: GatewayHeartbeat): Promise<unknown>;
  poll(gatewayId: string, after: string | null): Promise<GatewayPollResult>;
  ingestEvents(batch: EventBatch): Promise<string[]>;
}

export interface GatewayRequestContext {
  readonly gatewayId: string;
}

export class HttpError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function parseBearerSecret(value: string | undefined): string | undefined {
  if (!value?.startsWith("Bearer ")) {
    return undefined;
  }
  const token = value.slice("Bearer ".length).trim();
  return token || undefined;
}

function secretsEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export class GatewayService {
  public constructor(
    private readonly store: GatewayServiceStore,
    private readonly config: GatewayServiceConfig,
  ) {}

  public authenticate(headers: IncomingHttpHeaders): GatewayRequestContext {
    const gatewayId = headerValue(headers, "x-agent-gateway-id");
    const token = parseBearerSecret(headerValue(headers, "authorization"));
    if (!gatewayId || !IdentifierSchema.safeParse(gatewayId).success || !token) {
      throw new HttpError(401, "AUTHENTICATION_FAILED", "gateway authentication failed");
    }
    if (!secretsEqual(token, this.config.bearerSecret)) {
      throw new HttpError(401, "AUTHENTICATION_FAILED", "gateway authentication failed");
    }
    return { gatewayId };
  }

  public async register(context: GatewayRequestContext, input: unknown): Promise<object> {
    const payload = this.parsePayload(GatewayRegistrationSchema, input);
    this.assertGatewayMatches(context, payload.gatewayId);
    await this.store.register(payload);
    return {
      protocolVersion: 1,
      accepted: true,
      gatewayId: payload.gatewayId,
      bootId: payload.bootId,
    };
  }

  public async heartbeat(context: GatewayRequestContext, input: unknown): Promise<object> {
    const payload = this.parsePayload(GatewayHeartbeatSchema, input);
    this.assertGatewayMatches(context, payload.gatewayId);
    await this.store.heartbeat(payload);
    return {
      protocolVersion: 1,
      accepted: true,
      gatewayId: payload.gatewayId,
      bootId: payload.bootId,
    };
  }

  public async poll(
    context: GatewayRequestContext,
    after: string | null,
  ): Promise<CommandPollResponse> {
    if (after !== null && !IdentifierSchema.safeParse(after).success) {
      throw new HttpError(400, "INVALID_PAYLOAD", "after cursor is invalid");
    }
    const result = await this.store.poll(context.gatewayId, after);
    return CommandPollResponseSchema.parse({
      protocolVersion: 1,
      serverTime: new Date().toISOString(),
      commands: result.commands,
      stopControls: result.stopControls,
      nextCursor: result.nextCursor,
    });
  }

  public async events(context: GatewayRequestContext, input: unknown): Promise<EventAck> {
    const payload = this.parsePayload(EventBatchSchema, input);
    this.assertGatewayMatches(context, payload.gatewayId);
    const acceptedEventIds = await this.store.ingestEvents(payload);
    return EventAckSchema.parse({
      protocolVersion: 1,
      gatewayId: payload.gatewayId,
      bootId: payload.bootId,
      acceptedEventIds,
    });
  }

  public parseBody(input: string): unknown {
    if (!input.trim()) {
      throw new HttpError(400, "INVALID_PAYLOAD", "request body must be JSON");
    }
    try {
      return JSON.parse(input) as unknown;
    } catch {
      throw new HttpError(400, "INVALID_PAYLOAD", "request body must contain valid JSON");
    }
  }

  public health(): object {
    return { status: "ok", service: "computercraft-agents-control-plane" };
  }

  private parsePayload<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new HttpError(400, "INVALID_PAYLOAD", "request payload failed validation", false, {
        issues: result.error.issues,
      });
    }
    return result.data;
  }

  private assertGatewayMatches(context: GatewayRequestContext, payloadGatewayId: string): void {
    if (context.gatewayId !== payloadGatewayId) {
      throw new HttpError(
        401,
        "AUTHENTICATION_FAILED",
        "gateway identity does not match request payload",
      );
    }
  }
}

export function repositoryErrorToHttp(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  if (error instanceof RepositoryError) {
    const protocolCode =
      error.code === "UNKNOWN_WORKER"
        ? "UNKNOWN_WORKER"
        : error.code === "STALE_GATEWAY_BOOT"
          ? "INVALID_PAYLOAD"
          : "INTERNAL_ERROR";
    return new HttpError(error.statusCode, protocolCode, error.message, error.statusCode >= 500);
  }
  return new HttpError(500, "INTERNAL_ERROR", "internal control-plane error", true);
}

export function errorResponse(error: HttpError): object {
  return ErrorResponseSchema.parse({
    protocolVersion: 1,
    requestId: null,
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details,
    },
  });
}

export function createRepositoryService(
  repository: GatewayRuntimeRepository,
  bearerSecret: string,
): GatewayService {
  return new GatewayService(repository, { bearerSecret });
}
