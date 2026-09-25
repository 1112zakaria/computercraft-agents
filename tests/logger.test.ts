import assert from "node:assert/strict";
import test from "node:test";

import {
  createLogger,
  requestIdFromHeader,
  type StructuredLogRecord,
} from "../apps/control-plane/src/logger";

test("structured logger emits lineage fields and redacts sensitive values", () => {
  const records: StructuredLogRecord[] = [];
  const logger = createLogger("test-service", (record) => records.push(record));
  logger.info("command.completed", {
    requestId: "request-1",
    workerId: "alice",
    commandId: "command-1",
    taskId: "task-1",
    outcome: "success",
    authorization: "Bearer should-not-appear",
    nested: { gatewayBearerSecret: "also-hidden" },
  });

  assert.deepEqual(records[0], {
    timestamp: records[0]?.timestamp,
    level: "INFO",
    service: "test-service",
    event: "command.completed",
    requestId: "request-1",
    workerId: "alice",
    commandId: "command-1",
    taskId: "task-1",
    outcome: "success",
    authorization: "[REDACTED]",
    nested: { gatewayBearerSecret: "[REDACTED]" },
  });
  assert.match(records[0]?.timestamp ?? "", /^\d{4}-\d{2}-\d{2}T/);
});

test("request IDs accept safe client correlation IDs and replace unsafe values", () => {
  assert.equal(requestIdFromHeader("request-1"), "request-1");
  assert.notEqual(requestIdFromHeader("Bearer secret"), "Bearer secret");
  assert.match(requestIdFromHeader(undefined), /^[0-9a-f-]{36}$/);
});
