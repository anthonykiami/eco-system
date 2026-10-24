import { z } from "zod";

const nonEmpty = z.string().trim().min(1);

const booleanString = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const emailList = z
  .string()
  .default("")
  .transform((v) =>
    v
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
  .pipe(z.array(z.email()));

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // App
  APP_URL: z.url(),

  // Database
  DATABASE_URL: z.url(),

  // Auth
  AUTH_SECRET: nonEmpty,
  AUTH_GOOGLE_ID: nonEmpty,
  AUTH_GOOGLE_SECRET: nonEmpty,
  ADMIN_EMAILS: emailList,
  WAITLIST_MODE: booleanString,

  // Upstash
  UPSTASH_REDIS_REST_URL: z.url(),
  UPSTASH_REDIS_REST_TOKEN: nonEmpty,
  QSTASH_TOKEN: nonEmpty,
  QSTASH_CURRENT_SIGNING_KEY: nonEmpty,
  QSTASH_NEXT_SIGNING_KEY: nonEmpty,

  // Storage
  BLOB_READ_WRITE_TOKEN: nonEmpty,

  // AI + integrations
  ANTHROPIC_API_KEY: nonEmpty,
  COMPOSIO_API_KEY: nonEmpty,
  SUPERMEMORY_API_KEY: nonEmpty,
  /** Transcribes Telegram voice messages. Without it, the bot says voice isn't available. */
  GROQ_API_KEY: nonEmpty.optional(),

  // Telegram
  TELEGRAM_BOT_TOKEN: nonEmpty,
  TELEGRAM_BOT_USERNAME: nonEmpty,
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,256}$/, "Telegram allows only A-Z, a-z, 0-9, _ and - (1-256 chars)"),

  // Tracing
  LANGFUSE_PUBLIC_KEY: nonEmpty,
  LANGFUSE_SECRET_KEY: nonEmpty,
  LANGFUSE_HOST: z.url().default("https://cloud.langfuse.com"),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  // Escape hatch for tooling that imports app code without real secrets (e.g. lint in CI).
  if (process.env.SKIP_ENV_VALIDATION === "1") {
    return envSchema.partial().parse(process.env) as Env;
  }

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}\nSee .env.example.`);
  }
  // QStash signatures and OAuth callbacks are tied to APP_URL; a local value in production
  // silently breaks every scheduled task, so fail the deploy instead.
  const { hostname } = new URL(result.data.APP_URL);
  if (process.env.VERCEL_ENV === "production" && ["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname)) {
    throw new Error(`APP_URL is ${result.data.APP_URL} in production. Set it to the public URL, e.g. https://your-app.vercel.app.`);
  }
  return result.data;
}

export const env: Env = parseEnv();
