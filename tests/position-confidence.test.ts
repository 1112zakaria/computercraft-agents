import assert from "node:assert/strict";
import test from "node:test";
import { storedPositionConfidence } from "../packages/database/src/position-confidence";

test("wire position confidence maps to existing database constraints", () => {
  assert.equal(storedPositionConfidence("CONFIRMED"), "CONFIRMED_ANCHOR");
  assert.equal(storedPositionConfidence("ESTIMATED"), "DEAD_RECKONED");
  assert.equal(storedPositionConfidence("UNCERTAIN"), "UNKNOWN");
  assert.equal(storedPositionConfidence(undefined), null);
});
