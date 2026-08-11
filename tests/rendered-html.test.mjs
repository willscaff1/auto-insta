import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renderiza o painel editorial do AlertaTCG", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Painel de Publicações \| AlertaTCG<\/title>/i);
  assert.match(html, /Visão geral/);
  assert.match(html, /Fila editorial/);
  assert.match(html, /Publicados/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("mantém dados e capas publicados sincronizados", async () => {
  const dashboard = JSON.parse(
    await readFile(new URL("../public/dashboard-data.json", import.meta.url), "utf8"),
  );
  const thiago = dashboard.posts.find((post) => post.id === "thiago-nigro");

  assert.equal(dashboard.stats.published, 5);
  assert.equal(dashboard.stats.ready, 7);
  assert.equal(thiago.status, "published");
  assert.equal(
    thiago.publishedUrl,
    "https://www.instagram.com/alertatcg/p/Db42Z0nnNvc/",
  );
  await access(new URL("../public/thiago-nigro-charizard-cover.jpg", import.meta.url));
  await access(new URL("../public/psa-grading-guide-cover.jpg", import.meta.url));
});
