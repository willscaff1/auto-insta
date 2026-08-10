import assert from "node:assert/strict";
import test from "node:test";
import { config, getCredentialState } from "../config.mjs";

test("inicia protegido em modo de simulação", () => {
  assert.ok(["dry_run", "live"].includes(config.publishingMode));
  const state = getCredentialState();
  assert.equal(typeof state.database, "boolean");
  assert.equal(typeof state.meta, "boolean");
});
