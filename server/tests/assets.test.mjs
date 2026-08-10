import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve("server");

test("as dez campanhas têm legenda e pacote híbrido completo", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "content-seed.json"), "utf8"));
  assert.equal(manifest.length, 10);
  for (const item of manifest) {
    const media = path.join(root, "public", "media", item.slug);
    await access(path.join(root, "content", "captions", `${item.slug}.txt`));
    const video = await stat(path.join(media, "01-video.mp4"));
    const cover = await stat(path.join(media, "01-cover.jpg"));
    assert.ok(video.size > 100_000, `${item.slug}: vídeo vazio`);
    assert.ok(cover.size > 20_000, `${item.slug}: capa vazia`);
    for (let index = 2; index <= 7; index += 1) {
      const slide = await stat(path.join(media, `${String(index).padStart(2, "0")}.png`));
      assert.ok(slide.size > 50_000, `${item.slug}: slide ${index} vazio`);
    }
  }
});

test("todas as fontes usam HTTPS", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "content-seed.json"), "utf8"));
  for (const item of manifest) assert.equal(new URL(item.sourceUrl).protocol, "https:");
});
