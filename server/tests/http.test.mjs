import assert from "node:assert/strict";
import test from "node:test";
import { app } from "../index.mjs";

test("serve painel, saúde e dados locais", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${base}/health`).then((response) => response.json());
    const dashboard = await fetch(`${base}/api/dashboard`).then((response) => response.json());
    const html = await fetch(`${base}/`).then((response) => response.text());
    assert.equal(health.ok, true);
    assert.equal(health.service, "alertatcg-ops");
    assert.equal(dashboard.stats.ready, 10);
    assert.match(html, /AlertaTCG \| Operação 24\/7/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
