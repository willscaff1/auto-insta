import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DateTime } from "luxon";
import { config } from "./config.mjs";
import { migrate, pool, recordEvent, upsertContent } from "./db.mjs";

function mediaFor(slug) {
  const base = `/media/${slug}`;
  return [
    { type: "video", url: `${base}/01-video.mp4`, coverUrl: `${base}/01-cover.jpg` },
    ...Array.from({ length: 6 }, (_, index) => ({
      type: "image",
      url: `${base}/${String(index + 2).padStart(2, "0")}.png`,
    })),
  ];
}

export async function seedDatabase() {
  if (!pool) throw new Error("DATABASE_URL não configurada");
  await migrate();
  const manifest = JSON.parse(await readFile(new URL("./content-seed.json", import.meta.url), "utf8"));
  const saved = [];
  for (const item of manifest) {
    const caption = await readFile(new URL(`./content/captions/${item.slug}.txt`, import.meta.url), "utf8");
    saved.push(await upsertContent({
      ...item,
      caption,
      media: mediaFor(item.slug),
      status: item.status || "ready",
      origin: item.origin || "editorial",
      factCheck: item.factCheck || { verified: true, verifiedAt: "2026-08-10" },
    }));
  }

  const jobCount = await pool.query("SELECT COUNT(*)::int AS count FROM publication_jobs");
  if (jobCount.rows[0].count === 0) {
    const start = DateTime.now().setZone(config.timezone).plus({ days: 1 }).startOf("day");
    const editorial = saved.filter((item) => item.origin !== "promotion");
    for (let index = 0; index < editorial.length; index += 1) {
      const day = Math.floor(index / 2);
      const kind = index % 2 === 0 ? "carousel" : "reel";
      const scheduled = start.plus({ days: day }).set({ hour: kind === "carousel" ? 10 : 19 });
      await pool.query(
        `INSERT INTO publication_jobs (content_id, kind, scheduled_for)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [editorial[index].id, kind, scheduled.toUTC().toISO()],
      );
      if (kind === "reel") {
        await pool.query(
          `INSERT INTO publication_jobs (content_id, kind, scheduled_for)
           VALUES ($1,'story',$2) ON CONFLICT DO NOTHING`,
          [editorial[index].id, scheduled.plus({ minutes: 10 }).toUTC().toISO()],
        );
      }
      await pool.query("UPDATE content_items SET status = 'scheduled', updated_at = NOW() WHERE id = $1", [editorial[index].id]);
    }
  }
  await recordEvent("info", "database_seeded", `${saved.length} campanhas carregadas no calendário inicial`);
  return saved.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seedDatabase()
    .then((count) => console.log(`Seed concluído: ${count} campanhas`))
    .finally(() => pool?.end());
}
