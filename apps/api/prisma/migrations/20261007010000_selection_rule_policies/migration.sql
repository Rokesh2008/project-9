CREATE TABLE "SelectionRulePolicy" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "selectionCycleId" TEXT NOT NULL REFERENCES "SelectionCycle"("id") ON DELETE CASCADE,
 "domainId" TEXT REFERENCES "Domain"("id") ON DELETE RESTRICT,
 "scopeKey" TEXT NOT NULL,
 "program" TEXT NOT NULL DEFAULT 'BOTH' CHECK ("program" IN ('BOTH','HOPE','PEP')),
 "name" TEXT NOT NULL,
 "rules" JSONB NOT NULL,
 "isActive" BOOLEAN NOT NULL DEFAULT FALSE,
 "createdBy" TEXT NOT NULL,
 "activatedBy" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "activatedAt" TIMESTAMP(3),
 CHECK ("scopeKey" = COALESCE("domainId", 'GLOBAL'))
);
CREATE INDEX "SelectionRulePolicy_selectionCycleId_scopeKey_program_idx" ON "SelectionRulePolicy"("selectionCycleId","scopeKey","program");
CREATE UNIQUE INDEX "SelectionRulePolicy_one_active" ON "SelectionRulePolicy"("selectionCycleId","scopeKey","program") WHERE "isActive";
ALTER TABLE "SelectionRulePolicy" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "SelectionRulePolicy" FROM anon; END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "SelectionRulePolicy" FROM authenticated; END IF;
END $$;
ALTER TABLE "RankingSnapshotEntry" ADD COLUMN "hopeEligible" BOOLEAN, ADD COLUMN "pepEligible" BOOLEAN, ADD COLUMN "customEligibility" JSONB;
ALTER TABLE "HopePepClassification" ADD COLUMN "customEligibility" JSONB;
