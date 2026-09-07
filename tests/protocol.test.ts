import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  CommandSchema,
  ErrorResponseSchema,
  EventBatchSchema,
  GatewayHeartbeatSchema,
  GatewayRegistrationSchema,
  StopControlSchema,
  isSupportedProtocolVersion,
} from "../packages/protocol/src/index";

const fixturesRoot = join(__dirname, "../packages/protocol/fixtures");

function fixture(path: string): unknown {
  return JSON.parse(readFileSync(join(fixturesRoot, path), "utf8")) as unknown;
}

test("valid v1 gateway, heartbeat, command, event, and stop fixtures parse", () => {
  const registration = GatewayRegistrationSchema.parse(fixture("valid/gateway-registration.json"));
  const heartbeat = GatewayHeartbeatSchema.parse(fixture("valid/gateway-heartbeat.json"));
  const command = CommandSchema.parse(fixture("valid/navigate-command.json"));
  const events = EventBatchSchema.parse(fixture("valid/event-batch.json"));
  const stopControls = fixture("valid/stop-controls.json") as unknown[];

  assert.equal(registration.protocolVersion, 1);
  assert.equal(heartbeat.workers[0]?.workerId, "alice");
  assert.equal(command.skill, "navigate.path");
  assert.equal(events.events[0]?.type, "command.completed");
  assert.equal(Array.isArray(stopControls), true);
  assert.equal(StopControlSchema.safeParse(stopControls[0]).success, true);
  assert.equal(StopControlSchema.safeParse(stopControls[1]).success, true);
});

test("registration defaults omitted optional capabilities but requires protocol version", () => {
  const registration = GatewayRegistrationSchema.parse({
    protocolVersion: 1,
    gatewayId: "gateway-1",
    bootId: "boot-1",
    minecraftServerId: "server-1",
    workers: [],
  });

  assert.deepEqual(registration.capabilities, []);
  assert.equal(
    GatewayRegistrationSchema.safeParse(fixture("invalid/registration-missing-version.json"))
      .success,
    false,
  );
});

test("unknown skills and malformed arguments are rejected", () => {
  assert.equal(
    CommandSchema.safeParse(fixture("invalid/command-unknown-skill.json")).success,
    false,
  );
  assert.equal(
    CommandSchema.safeParse(fixture("invalid/command-invalid-arguments.json")).success,
    false,
  );
});

test("command events require command correlation and error responses are typed", () => {
  assert.equal(
    EventBatchSchema.safeParse(fixture("invalid/event-missing-command-id.json")).success,
    false,
  );

  const error = ErrorResponseSchema.parse({
    protocolVersion: 1,
    requestId: "req-1",
    error: {
      code: "INVALID_ARGUMENTS",
      message: "steps contains an unsupported direction",
      retryable: false,
    },
  });

  assert.equal(error.error.retryable, false);
  assert.equal(isSupportedProtocolVersion(error.protocolVersion), true);
  assert.equal(isSupportedProtocolVersion(2), false);
});
