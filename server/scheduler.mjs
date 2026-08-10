import { DateTime } from "luxon";
import { config, getCredentialState } from "./config.mjs";
import { getSetting, pool, recordEvent, setSetting } from "./db.mjs";
import { publishToInstagram } from "./meta.mjs";
import { researchOneTopic } from "./research.mjs";

let timer = null;
let ticking = false;

async function claimDueJob() {
  const result = await pool.query(
    `UPDATE publication_jobs
     SET status = 'processing', attempts = attempts + 1, locked_at = NOW(), updated_at = NOW()
     WHERE id = (
       SELECT id FROM publication_jobs
       WHERE status IN ('scheduled', 'retry', 'waiting_credentials')
         AND scheduled_for <= NOW()
         AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
       ORDER BY scheduled_for ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`,
  );
  return result.rows[0] || null;
}

async function loadContent(contentId) {
  const result = await pool.query("SELECT * FROM content_items WHERE id = $1", [contentId]);
  return result.rows[0] || null;
}

async function finishJob(job, outcome) {
  const status = outcome.status;
  await pool.query(
    `UPDATE publication_jobs SET status = $2, external_id = $3, permalink = $4,
      last_error = $5, result = $6::jsonb, next_attempt_at = $7, updated_at = NOW()
     WHERE id = $1`,
    [
      job.id,
      status,
      outcome.externalId || null,
      outcome.permalink || null,
      outcome.error || null,
      JSON.stringify(outcome.details || {}),
      outcome.nextAttemptAt || null,
    ],
  );
  await pool.query(
    `INSERT INTO publication_attempts (job_id, attempt, outcome, message, payload)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [job.id, job.attempts, status, outcome.error || null, JSON.stringify(outcome.details || {})],
  );
  if (status === "published") {
    await pool.query("UPDATE content_items SET status = 'published', updated_at = NOW() WHERE id = $1", [job.content_id]);
  }
}

async function processOneJob() {
  const job = await claimDueJob();
  if (!job) return false;
  const content = await loadContent(job.content_id);
  if (!content) {
    await finishJob(job, { status: "failed", error: "Conteúdo não encontrado" });
    return true;
  }

  const credentials = getCredentialState();
  if (config.publishingMode !== "live" || !credentials.meta || !credentials.publicUrl) {
    await finishJob(job, {
      status: "waiting_credentials",
      error: "Aguardando modo live, token Meta e URL pública",
      nextAttemptAt: DateTime.now().plus({ minutes: 15 }).toISO(),
    });
    return true;
  }

  try {
    const result = await publishToInstagram(job.kind, {
      ...content,
      media: typeof content.media === "string" ? JSON.parse(content.media) : content.media,
    });
    await finishJob(job, { status: "published", ...result, details: result.details });
    await recordEvent("info", "instagram_published", `${job.kind} publicado: ${content.title}`, result);
  } catch (error) {
    const attempts = Number(job.attempts);
    const retryable = attempts < 5;
    const delayMinutes = Math.min(120, 5 * 2 ** Math.max(0, attempts - 1));
    await finishJob(job, {
      status: retryable ? "retry" : "failed",
      error: error.message,
      nextAttemptAt: retryable ? DateTime.now().plus({ minutes: delayMinutes }).toISO() : null,
    });
    await recordEvent("error", "instagram_failed", `${job.kind} falhou: ${content.title}`, {
      jobId: job.id,
      attempt: attempts,
      error: error.message,
    });
  }
  return true;
}

async function scheduleReadyContent() {
  const ready = await pool.query(
    `SELECT c.* FROM content_items c
     WHERE c.status = 'ready'
       AND NOT EXISTS (SELECT 1 FROM publication_jobs j WHERE j.content_id = c.id)
     ORDER BY c.created_at ASC`,
  );
  if (!ready.rowCount) return 0;

  const latest = await pool.query(
    `SELECT scheduled_for FROM publication_jobs
     WHERE kind IN ('carousel', 'reel')
     ORDER BY scheduled_for DESC LIMIT 1`,
  );
  const now = DateTime.now().setZone(config.timezone);
  let cursor;
  if (latest.rows[0]) {
    const last = DateTime.fromJSDate(latest.rows[0].scheduled_for).setZone(config.timezone);
    cursor = last.hour < 19
      ? last.startOf("day").set({ hour: 19 })
      : last.plus({ days: 1 }).startOf("day").set({ hour: 10 });
  } else {
    cursor = now.plus({ days: 1 }).startOf("day").set({ hour: 10 });
  }
  if (cursor < now) cursor = now.plus({ days: 1 }).startOf("day").set({ hour: 10 });

  let count = 0;
  for (const content of ready.rows) {
    const kind = cursor.hour === 10 ? "carousel" : "reel";
    await pool.query(
      `INSERT INTO publication_jobs (content_id, kind, scheduled_for)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [content.id, kind, cursor.toUTC().toISO()],
    );
    if (kind === "reel") {
      await pool.query(
        `INSERT INTO publication_jobs (content_id, kind, scheduled_for)
         VALUES ($1,'story',$2) ON CONFLICT DO NOTHING`,
        [content.id, cursor.plus({ minutes: 10 }).toUTC().toISO()],
      );
    }
    await pool.query("UPDATE content_items SET status = 'scheduled', updated_at = NOW() WHERE id = $1", [content.id]);
    cursor = kind === "carousel"
      ? cursor.startOf("day").set({ hour: 19 })
      : cursor.plus({ days: 1 }).startOf("day").set({ hour: 10 });
    count += 1;
  }
  return count;
}

async function runDailyResearch() {
  const now = DateTime.now().setZone(config.timezone);
  if (now.hour < 7 || !config.research.enabled) return;
  const marker = await getSetting("last_research_date");
  if (marker?.date === now.toISODate()) return;

  const pending = await pool.query(
    `SELECT COUNT(*)::int AS count FROM publication_jobs
     WHERE kind IN ('carousel','reel') AND status IN ('scheduled','retry','waiting_credentials')`,
  );
  const missing = Math.max(0, config.minReadyFeedPosts - pending.rows[0].count);
  const titles = (await pool.query("SELECT title FROM content_items ORDER BY created_at DESC LIMIT 80")).rows.map((row) => row.title);
  for (let index = 0; index < Math.min(missing, 2); index += 1) {
    await researchOneTopic({ existingTitles: titles });
  }
  await setSetting("last_research_date", { date: now.toISODate(), missingBeforeRun: missing });
}

export async function schedulerTick() {
  if (ticking || !pool) return;
  ticking = true;
  try {
    await runDailyResearch();
    await scheduleReadyContent();
    for (let index = 0; index < 4; index += 1) {
      if (!(await processOneJob())) break;
    }
  } catch (error) {
    console.error("scheduler_tick_failed", error);
    await recordEvent("error", "scheduler_tick_failed", error.message);
  } finally {
    ticking = false;
  }
}

export function startScheduler() {
  if (!config.schedulerEnabled || !pool || timer) return false;
  schedulerTick();
  timer = setInterval(schedulerTick, config.schedulerPollMs);
  timer.unref();
  return true;
}

export { scheduleReadyContent };
