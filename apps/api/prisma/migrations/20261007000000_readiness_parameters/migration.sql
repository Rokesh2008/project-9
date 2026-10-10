CREATE TABLE "ReadinessAssessment" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "sourceResultId" TEXT NOT NULL,
  "sourceBatchId" TEXT NOT NULL,
  "readinessScore" DOUBLE PRECISION,
  "verificationStatus" TEXT NOT NULL,
  "parameterScores" JSONB NOT NULL,
  "assessedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReadinessAssessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReadinessAssessment_readinessScore_check" CHECK ("readinessScore" IS NULL OR "readinessScore" BETWEEN 0 AND 250)
);
CREATE UNIQUE INDEX "ReadinessAssessment_studentId_sourceResultId_key" ON "ReadinessAssessment"("studentId", "sourceResultId");
CREATE INDEX "ReadinessAssessment_studentId_assessedAt_idx" ON "ReadinessAssessment"("studentId", "assessedAt");
ALTER TABLE "ReadinessAssessment" ADD CONSTRAINT "ReadinessAssessment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReadinessAssessment" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "ReadinessAssessment" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "ReadinessAssessment" FROM authenticated;
  END IF;
END $$;
