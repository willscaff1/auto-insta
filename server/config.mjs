import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().optional(),
  PUBLIC_BASE_URL: z.string().url().optional(),
  ADMIN_API_KEY: z.string().min(12).optional(),
  APP_TIMEZONE: z.string().default("America/Cuiaba"),
  SCHEDULER_ENABLED: z.enum(["true", "false"]).default("false"),
  PUBLISHING_MODE: z.enum(["dry_run", "live"]).default("dry_run"),
  SCHEDULER_POLL_MS: z.coerce.number().int().min(5000).default(30000),
  META_API_VERSION: z.string().default("v24.0"),
  META_IG_USER_ID: z.string().optional(),
  META_ACCESS_TOKEN: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5.6-luna"),
  AUTO_RESEARCH_ENABLED: z.enum(["true", "false"]).default("false"),
  AUTO_APPROVE_RESEARCH: z.enum(["true", "false"]).default("false"),
  MIN_READY_FEED_POSTS: z.coerce.number().int().min(2).max(30).default(10),
});

const env = envSchema.parse(process.env);

export const config = {
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  publicBaseUrl: env.PUBLIC_BASE_URL?.replace(/\/$/, ""),
  adminApiKey: env.ADMIN_API_KEY,
  timezone: env.APP_TIMEZONE,
  schedulerEnabled: env.SCHEDULER_ENABLED === "true",
  publishingMode: env.PUBLISHING_MODE,
  schedulerPollMs: env.SCHEDULER_POLL_MS,
  minReadyFeedPosts: env.MIN_READY_FEED_POSTS,
  meta: {
    apiVersion: env.META_API_VERSION,
    igUserId: env.META_IG_USER_ID,
    accessToken: env.META_ACCESS_TOKEN,
  },
  research: {
    enabled: env.AUTO_RESEARCH_ENABLED === "true",
    autoApprove: env.AUTO_APPROVE_RESEARCH === "true",
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
  },
};

export function getCredentialState() {
  return {
    database: Boolean(config.databaseUrl),
    publicUrl: Boolean(config.publicBaseUrl),
    meta: Boolean(config.meta.igUserId && config.meta.accessToken),
    openai: Boolean(config.research.apiKey),
    live: config.publishingMode === "live",
  };
}
