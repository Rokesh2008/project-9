CREATE TABLE "RosterAllocation" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "trainingGroup" TEXT NOT NULL,
    "trainingLevel" TEXT,
    "sourceFile" TEXT NOT NULL,
    "sourceSheet" TEXT NOT NULL,
    "sourceRows" JSONB NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RosterAllocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RosterAllocation_studentId_key" ON "RosterAllocation"("studentId");
CREATE INDEX "RosterAllocation_trainingGroup_idx" ON "RosterAllocation"("trainingGroup");
ALTER TABLE "RosterAllocation" ADD CONSTRAINT "RosterAllocation_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
