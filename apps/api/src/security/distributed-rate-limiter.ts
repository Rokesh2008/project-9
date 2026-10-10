import { createHmac } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../common/prisma.service';

/** PostgreSQL atomic windows; no IP/email plaintext is persisted. */
export class DistributedRateLimiter {
  constructor(private readonly db: PrismaService, private readonly secret: string) {
    if (secret.length < 32) throw new Error('Distributed limiter requires a private signing secret');
  }

  async consume(scope: string, identity: string, limit: number) {
    const key = createHmac('sha256', this.secret).update(`${scope}\0${identity}`).digest('hex');
    const [row] = await this.db.$queryRaw<Array<{ count: number; retryAfter: number }>>`
      WITH cleanup AS (
        DELETE FROM "RateLimitWindow" WHERE "key" IN (
          SELECT "key" FROM "RateLimitWindow" WHERE "expiresAt" < NOW() - INTERVAL '1 hour' AND "key" <> ${key}
          ORDER BY "expiresAt" LIMIT 100 FOR UPDATE SKIP LOCKED
        )
      )
      INSERT INTO "RateLimitWindow" ("key", "count", "expiresAt")
      VALUES (${key}, 1, NOW() + INTERVAL '60 seconds')
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitWindow"."expiresAt" <= NOW() THEN 1 ELSE LEAST("RateLimitWindow"."count" + 1, ${limit + 1}) END,
        "expiresAt" = CASE WHEN "RateLimitWindow"."expiresAt" <= NOW() THEN NOW() + INTERVAL '60 seconds' ELSE "RateLimitWindow"."expiresAt" END
      RETURNING "count", GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("expiresAt" - NOW()))))::int AS "retryAfter"
    `;
    return { allowed: row.count <= limit, retryAfter: row.retryAfter };
  }

  middleware(account = false) {
    return (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api/health') || req.method === 'OPTIONS') return next();
      const login = req.path === '/api/auth/login' && req.method === 'POST';
      if (account && !login) return next();
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (account && (!email || email.length > 254)) return next();
      const identity = account ? email : req.ip ?? req.socket.remoteAddress ?? 'unknown';
      void this.consume(account ? 'account' : login ? 'login-ip' : 'api-ip', identity, account ? 12 : login ? 120 : 600)
        .then(result => {
          if (result.allowed) return next();
          res.setHeader('Retry-After', String(result.retryAfter));
          res.status(429).json({ message: 'Too many requests. Please retry later.' });
        }).catch(() => {
          // Never silently fall back to independent per-replica security limits.
          res.setHeader('Retry-After', '5');
          res.status(503).json({ message: 'Request protection temporarily unavailable. Please retry.' });
        });
    };
  }

  async prune() {
    // Bounded cleanup, suitable for an authenticated externally scheduled task.
    return this.db.$executeRaw`DELETE FROM "RateLimitWindow" WHERE "key" IN (SELECT "key" FROM "RateLimitWindow" WHERE "expiresAt" < NOW() - INTERVAL '1 hour' LIMIT 1000)`;
  }
}
