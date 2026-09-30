-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "attendancePercent" DOUBLE PRECISION,
ADD COLUMN     "cgpa" DOUBLE PRECISION,
ADD COLUMN     "dsaLevel" TEXT,
ADD COLUMN     "registerNumber" TEXT,
ADD COLUMN     "sourceUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StudentCredential" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "credentialType" TEXT NOT NULL DEFAULT 'CERTIFICATE',
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "hours" DOUBLE PRECISION,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "sourceIdentifier" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentCredential_sourceIdentifier_key" ON "StudentCredential"("sourceIdentifier");

-- CreateIndex
CREATE INDEX "StudentCredential_studentId_verificationStatus_idx" ON "StudentCredential"("studentId", "verificationStatus");

-- CreateIndex
CREATE INDEX "StudentCredential_studentId_name_idx" ON "StudentCredential"("studentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentResult_studentId_sourceIdentifier_key" ON "AssessmentResult"("studentId", "sourceIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "Student_registerNumber_key" ON "Student"("registerNumber");

-- AddForeignKey
ALTER TABLE "StudentCredential" ADD CONSTRAINT "StudentCredential_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
