import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { config } from "./config.mjs";

const { Pool } = pg;

export const pool = config.databaseUrl
  ? new Pool({
      connectionString: config.databaseUrl,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
      max: 8,
    })
  : null;

export function requireDatabase() {
  if (!pool) throw new Error("DATABASE_URL não configurada");
  return pool;
}

export async function migrate() {
  if (!pool) return false;
  const version = "001_initial";
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const existing = await pool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
  if (existing.rowCount) return true;

  const sql = await readFile(new URL("./migrations/001_initial.sql", import.meta.url), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING", [version]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return true;
}

export async function dbHealth() {
  if (!pool) return { configured: false, connected: false };
  try {
    await pool.query("SELECT 1");
    return { configured: true, connected: true };
  } catch (error) {
    return { configured: true, connected: false, error: error.message };
  }
}

export async function upsertContent(item) {
  const db = requireDatabase();
  const id = item.id || randomUUID();
  const result = await db.query(
    `INSERT INTO content_items (
      id, slug, title, kicker, caption, source_name, source_url,
      source_published_at, media, status, origin, fact_check
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb)
    ON CONFLICT (slug) DO UPDATE SET
      title = EXCLUDED.title,
      kicker = EXCLUDED.kicker,
      caption = EXCLUDED.caption,
      source_name = EXCLUDED.source_name,
      source_url = EXCLUDED.source_url,
      source_published_at = EXCLUDED.source_published_at,
      media = EXCLUDED.media,
      fact_check = EXCLUDED.fact_check,
      updated_at = NOW()
    RETURNING *`,
    [
      id,
      item.slug,
      item.title,
      item.kicker,
      item.caption,
      item.sourceName,
      item.sourceUrl,
      item.sourcePublishedAt || null,
      JSON.stringify(item.media || []),
      item.status || "ready",
      item.origin || "editorial",
      JSON.stringify(item.factCheck || {}),
    ],
  );
  return result.rows[0];
}

export async function recordEvent(level, eventType, message, details = {}) {
  if (!pool) return;
  await pool.query(
    "INSERT INTO operation_events (level, event_type, message, details) VALUES ($1,$2,$3,$4::jsonb)",
    [level, eventType, message, JSON.stringify(details)],
  );
}

export async function getSetting(key) {
  if (!pool) return null;
  const result = await pool.query("SELECT value FROM app_settings WHERE key = $1", [key]);
  return result.rows[0]?.value ?? null;
}

export async function setSetting(key, value) {
  const db = requireDatabase();
  await db.query(
    `INSERT INTO app_settings (key, value) VALUES ($1,$2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)],
  );
}
