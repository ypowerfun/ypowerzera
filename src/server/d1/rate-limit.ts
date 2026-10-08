import type { D1Database } from "@cloudflare/workers-types";

export async function reserveD1RateLimit(db: D1Database, key: string, limit: number, windowSeconds: number, now = Date.now()) {
  const row = await db.prepare(`INSERT INTO RateLimit(key,count,resetAt) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN RateLimit.resetAt<=? THEN 1 ELSE RateLimit.count+1 END,
      resetAt=CASE WHEN RateLimit.resetAt<=? THEN excluded.resetAt ELSE RateLimit.resetAt END
    WHERE RateLimit.resetAt<=? OR RateLimit.count<? RETURNING key`)
    .bind(key,now+windowSeconds*1000,now,now,now,limit).first();
  return row !== null;
}
