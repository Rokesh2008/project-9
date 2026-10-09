CREATE TABLE "SharedStateRecord" (
  "namespace" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("namespace", "key")
);

-- One outstanding recommendation per student/cycle across all replicas.
CREATE UNIQUE INDEX "SharedStateRecord_pending_recommendation"
  ON "SharedStateRecord" (("value"->>'studentId'), (COALESCE("value"->>'selectionCycleId', '')))
  WHERE "namespace" = 'recommendations' AND "value"->>'status' = 'PENDING_APPROVAL';

CREATE TABLE "RateLimitWindow" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "RateLimitWindow_expiresAt_idx" ON "RateLimitWindow" ("expiresAt");

-- Deliberately NO automatic snapshot copy here. A separate quiesced cutover
-- transaction is required, otherwise the old revision could write after copy.
