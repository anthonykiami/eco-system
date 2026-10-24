// Dummy values so lib/env.ts validates in tests. Tests must never hit real services.
const testEnv: Record<string, string> = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  AUTH_SECRET: "test-secret",
  AUTH_GOOGLE_ID: "test",
  AUTH_GOOGLE_SECRET: "test",
  ADMIN_EMAILS: "admin@example.com",
  WAITLIST_MODE: "false",
  UPSTASH_REDIS_REST_URL: "https://test.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "test",
  QSTASH_TOKEN: "test",
  QSTASH_CURRENT_SIGNING_KEY: "test",
  QSTASH_NEXT_SIGNING_KEY: "test",
  BLOB_READ_WRITE_TOKEN: "test",
  ANTHROPIC_API_KEY: "test",
  COMPOSIO_API_KEY: "test",
  SUPERMEMORY_API_KEY: "test",
  GROQ_API_KEY: "test",
  TELEGRAM_BOT_TOKEN: "test",
  TELEGRAM_BOT_USERNAME: "test_bot",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
  LANGFUSE_PUBLIC_KEY: "test",
  LANGFUSE_SECRET_KEY: "test",
  LANGFUSE_HOST: "https://cloud.langfuse.com",
};

for (const [key, value] of Object.entries(testEnv)) {
  process.env[key] ??= value;
}
