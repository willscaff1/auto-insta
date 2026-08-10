import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import { config } from "./config.mjs";
import { buildDashboard } from "./dashboard.mjs";
import { dbHealth, migrate, pool, recordEvent } from "./db.mjs";
import { scheduleReadyContent, schedulerTick, startScheduler, triggerPromotion } from "./scheduler.mjs";
import { seedDatabase } from "./seed.mjs";

const app = express();
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      mediaSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));
app.use(express.json({ limit: "200kb" }));

function authorized(request) {
  if (!config.adminApiKey) return true;
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") || request.headers["x-api-key"] || "";
  const expected = Buffer.from(config.adminApiKey);
  const actual = Buffer.from(String(supplied));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function requireAdmin(request, response, next) {
  if (!authorized(request)) return response.status(401).json({ error: "Chave do painel inválida" });
  next();
}

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "alertatcg-ops", time: new Date().toISOString() });
});

app.get("/ready", async (_request, response) => {
  const database = await dbHealth();
  response.status(database.connected ? 200 : 503).json({ ok: database.connected, database });
});

app.get("/api/dashboard", requireAdmin, async (_request, response, next) => {
  try {
    response.setHeader("Cache-Control", "no-store");
    response.json(await buildDashboard());
  } catch (error) { next(error); }
});

app.post("/api/operations/seed", requireAdmin, async (_request, response, next) => {
  try {
    const count = await seedDatabase();
    response.json({ ok: true, count });
  } catch (error) { next(error); }
});

app.post("/api/operations/tick", requireAdmin, async (_request, response, next) => {
  try {
    await schedulerTick();
    response.json({ ok: true });
  } catch (error) { next(error); }
});

app.post("/api/operations/schedule", requireAdmin, async (_request, response, next) => {
  try {
    const count = await scheduleReadyContent();
    response.json({ ok: true, count });
  } catch (error) { next(error); }
});

app.post("/api/operations/promotions/:slug/trigger", requireAdmin, async (request, response, next) => {
  try {
    const job = await triggerPromotion(request.params.slug);
    await schedulerTick();
    response.json({ ok: true, job });
  } catch (error) { next(error); }
});

app.use(express.static(fileURLToPath(new URL("./public", import.meta.url)), {
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  setHeaders(response, filePath) {
    if (filePath.endsWith(".mp4")) response.setHeader("Accept-Ranges", "bytes");
  },
}));

app.use((error, _request, response, _next) => {
  void _next;
  console.error(error);
  response.status(500).json({ error: error.message || "Falha interna" });
});

export async function boot(port = config.port) {
  if (pool) {
    await migrate();
    await recordEvent("info", "service_started", "Serviço AlertaTCG iniciado", {
      scheduler: config.schedulerEnabled,
      publishingMode: config.publishingMode,
    });
  }
  const scheduler = startScheduler();
  return app.listen(port, "0.0.0.0", () => {
    console.log(`AlertaTCG em http://0.0.0.0:${port} | scheduler=${scheduler}`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  boot().catch((error) => {
    console.error("boot_failed", error);
    process.exitCode = 1;
  });
  process.on("SIGTERM", async () => {
    await pool?.end();
    process.exit(0);
  });
}

export { app };
