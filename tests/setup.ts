// Global test setup for Vitest
process.env.TOKEN_ENCRYPTION_KEY = "Kn087lpoxxw69rDyfxzC95VoS4p0mt9m64cEinQpTQo=";
process.env.GITHUB_WEBHOOK_SECRET = "test_webhook_secret_1234567890";
process.env.NEXTAUTH_SECRET = "test_nextauth_secret_abcdef123456";
process.env.CRON_SECRET = "test_cron_secret_high_entropy_key";
process.env.DATABASE_URL = "postgresql://mock:mock@localhost:5432/mock";
