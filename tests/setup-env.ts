import path from "node:path";

process.env.DATABASE_URL = `file:${path.resolve(__dirname, "../.test-db/test.db")}?connection_limit=1&socket_timeout=30`;
process.env.APP_URL = "http://localhost:3000";
process.env.APP_SECRET = "test-secret-test-secret-test-secret-123456";
process.env.PAYMENTS_PROVIDER = "mock";
process.env.PLATFORM_FEE_BPS = "1000";

process.env.AUTH_PROVIDER = "local";
