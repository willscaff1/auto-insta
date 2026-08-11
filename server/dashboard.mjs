import { readFile } from "node:fs/promises";
import { DateTime } from "luxon";
import { config, getCredentialState } from "./config.mjs";
import { dbHealth, pool } from "./db.mjs";

function normalizeContent(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    kicker: row.kicker,
    caption: row.caption,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    media: typeof row.media === "string" ? JSON.parse(row.media) : row.media,
    contentStatus: row.status,
    origin: row.origin,
  };
}

function mediaFor(slug) {
  const base = `/media/${slug}`;
  return [
    { type: "video", url: `${base}/01-video.mp4`, coverUrl: `${base}/01-cover.jpg` },
    ...Array.from({ length: 6 }, (_, index) => ({ type: "image", url: `${base}/${String(index + 2).padStart(2, "0")}.png` })),
  ];
}

async function seedContent() {
  const manifest = JSON.parse(await readFile(new URL("./content-seed.json", import.meta.url), "utf8"));
  return manifest.filter((item) => item.origin !== "promotion").map((item) => ({
    id: item.slug,
    ...item,
    caption: "",
    media: mediaFor(item.slug),
    contentStatus: item.status || "ready",
    origin: item.origin || "editorial",
  }));
}

export async function buildDashboard() {
  const database = await dbHealth();
  const credentials = getCredentialState();
  if (!pool || !database.connected) {
    const readyItems = await seedContent();
    return {
      account: "@alertatcg",
      lastSync: new Date().toISOString(),
      timezone: config.timezone,
      runtime: { scheduler: false, publishingMode: config.publishingMode, credentials, database },
      stats: { published: 1, scheduled: 0, ready: readyItems.length, failed: 0, stories: 0 },
      jobs: [],
      readyItems,
      events: [],
    };
  }

  const [jobs, stats, content, readyItems, events] = await Promise.all([
    pool.query(
      `SELECT j.*, c.title, c.kicker, c.slug, c.media, c.source_name, c.source_url,
              c.caption, c.status AS content_status, c.origin
       FROM publication_jobs j JOIN content_items c ON c.id = j.content_id
       WHERE c.origin <> 'promotion'
       ORDER BY j.scheduled_for ASC LIMIT 80`,
    ),
    pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'published')::int AS published,
        COUNT(*) FILTER (WHERE status IN ('scheduled','retry','waiting_credentials'))::int AS scheduled,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE kind = 'story' AND status = 'published')::int AS stories
       FROM publication_jobs j JOIN content_items c ON c.id = j.content_id
       WHERE c.origin <> 'promotion'`,
    ),
    pool.query("SELECT COUNT(*) FILTER (WHERE status IN ('ready','scheduled'))::int AS ready FROM content_items WHERE origin <> 'promotion'"),
    pool.query("SELECT * FROM content_items WHERE status = 'ready' AND origin <> 'promotion' ORDER BY created_at ASC LIMIT 80"),
    pool.query("SELECT * FROM operation_events WHERE event_type NOT LIKE 'promotion_%' ORDER BY created_at DESC LIMIT 20"),
  ]);
  const stat = stats.rows[0];
  return {
    account: "@alertatcg",
    lastSync: new Date().toISOString(),
    timezone: config.timezone,
    runtime: {
      scheduler: config.schedulerEnabled,
      publishingMode: config.publishingMode,
      credentials,
      database,
      research: { enabled: config.research.enabled, autoApprove: config.research.autoApprove },
    },
    stats: {
      published: stat.published + 1,
      scheduled: stat.scheduled,
      ready: content.rows[0].ready,
      failed: stat.failed,
      stories: stat.stories,
    },
    jobs: jobs.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      scheduledFor: DateTime.fromJSDate(row.scheduled_for).setZone(config.timezone).toISO(),
      attempts: row.attempts,
      lastError: row.last_error,
      permalink: row.permalink,
      content: normalizeContent(row),
    })),
    readyItems: readyItems.rows.map(normalizeContent),
    events: events.rows.map((event) => ({
      id: event.id,
      level: event.level,
      type: event.event_type,
      message: event.message,
      createdAt: event.created_at,
    })),
  };
}
