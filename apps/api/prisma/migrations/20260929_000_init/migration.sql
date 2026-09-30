-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'COORDINATOR', 'PEP_STAFF', 'STUDENT');

-- CreateEnum
CREATE TYPE "WorkflowState" AS ENUM ('IMPORTED', 'ELIGIBILITY', 'HOPE_PEP', 'COMMUNICATION', 'INTERVIEW', 'SELECTION', 'ALLOCATION', 'ADMIN_REVIEW', 'FINALIZED', 'FROZEN');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'FROZEN', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssessmentType" AS ENUM ('CODING', 'COMMUNICATION', 'TECHNICAL', 'INTERVIEW', 'APTITUDE', 'OTHER');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'FROZEN', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "AdminDecisionType" AS ENUM ('APPROVE_ALLOCATION', 'OVERRIDE_ALLOCATION', 'REJECT_ALLOCATION', 'REQUEST_RE_ALLOCATION', 'SPECIAL_CONSIDERATION');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('WORKFLOW_TRANSITION', 'PREFERENCE_SUBMITTED', 'SELECTION_STATUS', 'ALLOCATION_RESULT', 'ADMIN_DECISION', 'FINALIZATION', 'FREEZE', 'GENERAL');

-- CreateEnum
CREATE TYPE "FreezeStatus" AS ENUM ('SCHEDULED', 'EXECUTED', 'CANCELLED', 'POSTPONED');

-- CreateEnum
CREATE TYPE "ClassificationStatus" AS ENUM ('CLASSIFIED', 'HOPE_INTERVIEW_FAILED', 'PEP_FALLBACK_ALLOWED', 'PEP_FALLBACK_DENIED');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('PROCESSING', 'SUCCEEDED', 'FAILED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'VERIFIED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STUDENT',
    "studentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "batchIdentifier" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "contactNo" TEXT,
    "batchId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelectionCycle" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "academicPeriod" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "CycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelectionCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentResult" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sourceIdentifier" TEXT NOT NULL,
    "assessmentType" "AssessmentType" NOT NULL DEFAULT 'TECHNICAL',
    "score" DOUBLE PRECISION NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL DEFAULT 100.0,
    "percentage" DOUBLE PRECISION,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "assessmentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainRequirement" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "requirementType" TEXT NOT NULL,
    "requirementKey" TEXT NOT NULL,
    "minimumValue" DOUBLE PRECISION,
    "stringValue" TEXT,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingBatch" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "batchCode" TEXT NOT NULL,
    "batchName" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "scheduleInfo" TEXT,
    "maxCapacity" INTEGER NOT NULL,
    "currentAllocated" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentPreference" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "selectionCycleId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "preferenceRank" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentCycleStatus" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "selectionCycleId" TEXT NOT NULL,
    "currentState" "WorkflowState" NOT NULL DEFAULT 'IMPORTED',
    "isFrozen" BOOLEAN NOT NULL DEFAULT false,
    "frozenAt" TIMESTAMP(3),
    "frozenBy" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentCycleStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowAuditLog" (
    "id" TEXT NOT NULL,
    "studentCycleStatusId" TEXT,
    "studentId" TEXT NOT NULL,
    "selectionCycleId" TEXT NOT NULL,
    "fromState" "WorkflowState" NOT NULL,
    "toState" "WorkflowState" NOT NULL,
    "actor" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "selectionCycleId" TEXT NOT NULL,
    "domainId" TEXT,
    "trainingBatchId" TEXT,
    "status" "AllocationStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "preferenceRankUsed" INTEGER,
    "selectionResultReference" TEXT,
    "failureReason" TEXT,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isFinalized" BOOLEAN NOT NULL DEFAULT false,
    "finalizedAt" TIMESTAMP(3),
    "finalizedBy" TEXT,
    "isFrozen" BOOLEAN NOT NULL DEFAULT false,
    "frozenAt" TIMESTAMP(3),
    "frozenBy" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminDecision" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "selectionCycleId" TEXT NOT NULL,
    "decisionType" "AdminDecisionType" NOT NULL,
    "reason" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "targetDomainId" TEXT,
    "targetBatchId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "recipientRole" TEXT,
    "type" "NotificationType" NOT NULL DEFAULT 'GENERAL',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CycleConfig" (
    "id" TEXT NOT NULL,
    "selectionCycleId" TEXT NOT NULL,
    "activeWeightVersionId" TEXT,
    "hopeCount" INTEGER NOT NULL,
    "pepCount" INTEGER NOT NULL,
    "eligibilityRuleVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CycleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityRuleVersion" (
    "id" TEXT NOT NULL,
    "selectionCycleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EligibilityRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityResult" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "selectionCycleId" TEXT NOT NULL,
    "ruleVersionId" TEXT NOT NULL,
    "isEligible" BOOLEAN NOT NULL,
    "failedRules" JSONB,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EligibilityResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeightVersion" (
    "id" TEXT NOT NULL,
    "selectionCycleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeightVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParameterWeight" (
    "id" TEXT NOT NULL,
    "weightVersionId" TEXT NOT NULL,
    "parameterKey" TEXT NOT NULL,
    "parameterLabel" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "maxRawScore" DOUBLE PRECISION NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ParameterWeight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentScore" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "selectionCycleId" TEXT NOT NULL,
    "weightVersionId" TEXT NOT NULL,
    "parameterKey" TEXT NOT NULL,
    "rawScore" DOUBLE PRECISION NOT NULL,
    "isMissing" BOOLEAN NOT NULL DEFAULT false,
    "normalizedScore" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "weightedScore" DOUBLE PRECISION NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentRanking" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "selectionCycleId" TEXT NOT NULL,
    "weightVersionId" TEXT NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL,
    "percentile" DOUBLE PRECISION,
    "tieBreakApplied" BOOLEAN NOT NULL DEFAULT false,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentRanking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreezeSchedule" (
    "id" TEXT NOT NULL,
    "selectionCycleId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "FreezeStatus" NOT NULL DEFAULT 'SCHEDULED',
    "executedAt" TIMESTAMP(3),
    "snapshotId" TEXT,
    "scheduledBy" TEXT NOT NULL,
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreezeSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingSnapshot" (
    "id" TEXT NOT NULL,
    "selectionCycleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "weightVersionId" TEXT NOT NULL,
    "ruleVersionId" TEXT,
    "hopeCount" INTEGER NOT NULL,
    "pepCount" INTEGER NOT NULL,
    "totalStudents" INTEGER NOT NULL,
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frozenBy" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "RankingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingSnapshotEntry" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "percentile" DOUBLE PRECISION,
    "parameterScores" JSONB NOT NULL,
    "isEligible" BOOLEAN NOT NULL,
    "eligibilityFailures" JSONB,
    "program" TEXT,
    "tieBreakApplied" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RankingSnapshotEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HopePepClassification" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "selectionCycleId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "program" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "status" "ClassificationStatus" NOT NULL DEFAULT 'CLASSIFIED',
    "adminDecisionBy" TEXT,
    "adminDecisionAt" TIMESTAMP(3),
    "adminDecisionReason" TEXT,
    "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HopePepClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreAuditLog" (
    "id" TEXT NOT NULL,
    "selectionCycleId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "role" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "previousValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuntimeState" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuntimeState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSource" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationJob" (
    "id" TEXT NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'PROCESSING',
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "error" JSONB,

    CONSTRAINT "IntegrationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationLog" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalReference" (
    "id" TEXT NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "internalId" TEXT NOT NULL,
    "sourceMeta" JSONB,

    CONSTRAINT "ExternalReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiStudentAnalysis" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "strengths" JSONB NOT NULL,
    "gaps" JSONB NOT NULL,
    "trend" TEXT NOT NULL,
    "recommendedDomains" JSONB NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "advisoryOnly" BOOLEAN NOT NULL DEFAULT true,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiStudentAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "cycleId" INTEGER,
    "state" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRecommendation" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "recommendedDomain" TEXT NOT NULL,
    "rationale" JSONB NOT NULL,
    "conflicts" JSONB NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSnapshot" (
    "id" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "cycleId" INTEGER,
    "filters" JSONB,
    "totals" JSONB NOT NULL,
    "storagePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_studentId_key" ON "User"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_batchIdentifier_key" ON "Batch"("batchIdentifier");

-- CreateIndex
CREATE INDEX "Batch_departmentId_idx" ON "Batch"("departmentId");

-- CreateIndex
CREATE INDEX "Batch_academicYear_idx" ON "Batch"("academicYear");

-- CreateIndex
CREATE UNIQUE INDEX "Student_studentId_key" ON "Student"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_email_key" ON "Student"("email");

-- CreateIndex
CREATE INDEX "Student_batchId_idx" ON "Student"("batchId");

-- CreateIndex
CREATE INDEX "Student_studentId_idx" ON "Student"("studentId");

-- CreateIndex
CREATE INDEX "Student_email_idx" ON "Student"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SelectionCycle_code_key" ON "SelectionCycle"("code");

-- CreateIndex
CREATE INDEX "AssessmentResult_studentId_assessmentType_idx" ON "AssessmentResult"("studentId", "assessmentType");

-- CreateIndex
CREATE INDEX "AssessmentResult_studentId_createdAt_idx" ON "AssessmentResult"("studentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Program_code_key" ON "Program"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_code_key" ON "Domain"("code");

-- CreateIndex
CREATE INDEX "Domain_programId_idx" ON "Domain"("programId");

-- CreateIndex
CREATE INDEX "DomainRequirement_domainId_idx" ON "DomainRequirement"("domainId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingBatch_batchCode_key" ON "TrainingBatch"("batchCode");

-- CreateIndex
CREATE INDEX "TrainingBatch_domainId_idx" ON "TrainingBatch"("domainId");

-- CreateIndex
CREATE INDEX "StudentPreference_studentId_selectionCycleId_idx" ON "StudentPreference"("studentId", "selectionCycleId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentPreference_studentId_selectionCycleId_preferenceRank_key" ON "StudentPreference"("studentId", "selectionCycleId", "preferenceRank");

-- CreateIndex
CREATE UNIQUE INDEX "StudentPreference_studentId_selectionCycleId_domainId_key" ON "StudentPreference"("studentId", "selectionCycleId", "domainId");

-- CreateIndex
CREATE INDEX "StudentCycleStatus_studentId_selectionCycleId_idx" ON "StudentCycleStatus"("studentId", "selectionCycleId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentCycleStatus_studentId_selectionCycleId_key" ON "StudentCycleStatus"("studentId", "selectionCycleId");

-- CreateIndex
CREATE INDEX "WorkflowAuditLog_studentId_selectionCycleId_idx" ON "WorkflowAuditLog"("studentId", "selectionCycleId");

-- CreateIndex
CREATE INDEX "WorkflowAuditLog_createdAt_idx" ON "WorkflowAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Allocation_selectionCycleId_status_idx" ON "Allocation"("selectionCycleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Allocation_studentId_selectionCycleId_key" ON "Allocation"("studentId", "selectionCycleId");

-- CreateIndex
CREATE INDEX "AdminDecision_studentId_selectionCycleId_idx" ON "AdminDecision"("studentId", "selectionCycleId");

-- CreateIndex
CREATE INDEX "AdminDecision_createdAt_idx" ON "AdminDecision"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_recipient_isRead_idx" ON "Notification"("recipient", "isRead");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CycleConfig_selectionCycleId_key" ON "CycleConfig"("selectionCycleId");

-- CreateIndex
CREATE INDEX "EligibilityRuleVersion_selectionCycleId_isActive_idx" ON "EligibilityRuleVersion"("selectionCycleId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "EligibilityRuleVersion_selectionCycleId_version_key" ON "EligibilityRuleVersion"("selectionCycleId", "version");

-- CreateIndex
CREATE INDEX "EligibilityResult_selectionCycleId_isEligible_idx" ON "EligibilityResult"("selectionCycleId", "isEligible");

-- CreateIndex
CREATE UNIQUE INDEX "EligibilityResult_studentId_selectionCycleId_key" ON "EligibilityResult"("studentId", "selectionCycleId");

-- CreateIndex
CREATE INDEX "WeightVersion_selectionCycleId_idx" ON "WeightVersion"("selectionCycleId");

-- CreateIndex
CREATE UNIQUE INDEX "WeightVersion_selectionCycleId_version_key" ON "WeightVersion"("selectionCycleId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ParameterWeight_weightVersionId_parameterKey_key" ON "ParameterWeight"("weightVersionId", "parameterKey");

-- CreateIndex
CREATE INDEX "StudentScore_selectionCycleId_weightVersionId_idx" ON "StudentScore"("selectionCycleId", "weightVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentScore_studentId_selectionCycleId_weightVersionId_par_key" ON "StudentScore"("studentId", "selectionCycleId", "weightVersionId", "parameterKey");

-- CreateIndex
CREATE INDEX "StudentRanking_selectionCycleId_rank_idx" ON "StudentRanking"("selectionCycleId", "rank");

-- CreateIndex
CREATE INDEX "StudentRanking_selectionCycleId_totalScore_idx" ON "StudentRanking"("selectionCycleId", "totalScore");

-- CreateIndex
CREATE UNIQUE INDEX "StudentRanking_studentId_selectionCycleId_key" ON "StudentRanking"("studentId", "selectionCycleId");

-- CreateIndex
CREATE INDEX "FreezeSchedule_selectionCycleId_status_idx" ON "FreezeSchedule"("selectionCycleId", "status");

-- CreateIndex
CREATE INDEX "FreezeSchedule_scheduledAt_status_idx" ON "FreezeSchedule"("scheduledAt", "status");

-- CreateIndex
CREATE INDEX "RankingSnapshot_selectionCycleId_idx" ON "RankingSnapshot"("selectionCycleId");

-- CreateIndex
CREATE UNIQUE INDEX "RankingSnapshot_selectionCycleId_version_key" ON "RankingSnapshot"("selectionCycleId", "version");

-- CreateIndex
CREATE INDEX "RankingSnapshotEntry_snapshotId_rank_idx" ON "RankingSnapshotEntry"("snapshotId", "rank");

-- CreateIndex
CREATE INDEX "RankingSnapshotEntry_snapshotId_program_idx" ON "RankingSnapshotEntry"("snapshotId", "program");

-- CreateIndex
CREATE UNIQUE INDEX "RankingSnapshotEntry_snapshotId_studentId_key" ON "RankingSnapshotEntry"("snapshotId", "studentId");

-- CreateIndex
CREATE INDEX "HopePepClassification_selectionCycleId_program_idx" ON "HopePepClassification"("selectionCycleId", "program");

-- CreateIndex
CREATE INDEX "HopePepClassification_selectionCycleId_status_idx" ON "HopePepClassification"("selectionCycleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HopePepClassification_studentId_selectionCycleId_key" ON "HopePepClassification"("studentId", "selectionCycleId");

-- CreateIndex
CREATE INDEX "ScoreAuditLog_selectionCycleId_action_idx" ON "ScoreAuditLog"("selectionCycleId", "action");

-- CreateIndex
CREATE INDEX "ScoreAuditLog_selectionCycleId_createdAt_idx" ON "ScoreAuditLog"("selectionCycleId", "createdAt");

-- CreateIndex
CREATE INDEX "ScoreAuditLog_entityType_entityId_idx" ON "ScoreAuditLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationSource_code_key" ON "IntegrationSource"("code");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationJob_idempotencyKey_key" ON "IntegrationJob"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalReference_sourceCode_entityType_externalId_key" ON "ExternalReference"("sourceCode", "entityType", "externalId");

-- CreateIndex
CREATE INDEX "AiStudentAnalysis_studentId_generatedAt_idx" ON "AiStudentAnalysis"("studentId", "generatedAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentResult" ADD CONSTRAINT "AssessmentResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainRequirement" ADD CONSTRAINT "DomainRequirement_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingBatch" ADD CONSTRAINT "TrainingBatch_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPreference" ADD CONSTRAINT "StudentPreference_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPreference" ADD CONSTRAINT "StudentPreference_selectionCycleId_fkey" FOREIGN KEY ("selectionCycleId") REFERENCES "SelectionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPreference" ADD CONSTRAINT "StudentPreference_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentCycleStatus" ADD CONSTRAINT "StudentCycleStatus_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentCycleStatus" ADD CONSTRAINT "StudentCycleStatus_selectionCycleId_fkey" FOREIGN KEY ("selectionCycleId") REFERENCES "SelectionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAuditLog" ADD CONSTRAINT "WorkflowAuditLog_studentCycleStatusId_fkey" FOREIGN KEY ("studentCycleStatusId") REFERENCES "StudentCycleStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAuditLog" ADD CONSTRAINT "WorkflowAuditLog_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowAuditLog" ADD CONSTRAINT "WorkflowAuditLog_selectionCycleId_fkey" FOREIGN KEY ("selectionCycleId") REFERENCES "SelectionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_selectionCycleId_fkey" FOREIGN KEY ("selectionCycleId") REFERENCES "SelectionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_trainingBatchId_fkey" FOREIGN KEY ("trainingBatchId") REFERENCES "TrainingBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminDecision" ADD CONSTRAINT "AdminDecision_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminDecision" ADD CONSTRAINT "AdminDecision_selectionCycleId_fkey" FOREIGN KEY ("selectionCycleId") REFERENCES "SelectionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleConfig" ADD CONSTRAINT "CycleConfig_selectionCycleId_fkey" FOREIGN KEY ("selectionCycleId") REFERENCES "SelectionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleConfig" ADD CONSTRAINT "CycleConfig_activeWeightVersionId_fkey" FOREIGN KEY ("activeWeightVersionId") REFERENCES "WeightVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleConfig" ADD CONSTRAINT "CycleConfig_eligibilityRuleVersionId_fkey" FOREIGN KEY ("eligibilityRuleVersionId") REFERENCES "EligibilityRuleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityRuleVersion" ADD CONSTRAINT "EligibilityRuleVersion_selectionCycleId_fkey" FOREIGN KEY ("selectionCycleId") REFERENCES "SelectionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityResult" ADD CONSTRAINT "EligibilityResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityResult" ADD CONSTRAINT "EligibilityResult_selectionCycleId_fkey" FOREIGN KEY ("selectionCycleId") REFERENCES "SelectionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityResult" ADD CONSTRAINT "EligibilityResult_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "EligibilityRuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightVersion" ADD CONSTRAINT "WeightVersion_selectionCycleId_fkey" FOREIGN KEY ("selectionCycleId") REFERENCES "SelectionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParameterWeight" ADD CONSTRAINT "ParameterWeight_weightVersionId_fkey" FOREIGN KEY ("weightVersionId") REFERENCES "WeightVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentScore" ADD CONSTRAINT "StudentScore_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentScore" ADD CONSTRAINT "StudentScore_selectionCycleId_fkey" FOREIGN KEY ("selectionCycleId") REFERENCES "SelectionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentScore" ADD CONSTRAINT "StudentScore_weightVersionId_fkey" FOREIGN KEY ("weightVersionId") REFERENCES "WeightVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRanking" ADD CONSTRAINT "StudentRanking_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRanking" ADD CONSTRAINT "StudentRanking_selectionCycleId_fkey" FOREIGN KEY ("selectionCycleId") REFERENCES "SelectionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRanking" ADD CONSTRAINT "StudentRanking_weightVersionId_fkey" FOREIGN KEY ("weightVersionId") REFERENCES "WeightVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreezeSchedule" ADD CONSTRAINT "FreezeSchedule_selectionCycleId_fkey" FOREIGN KEY ("selectionCycleId") REFERENCES "SelectionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreezeSchedule" ADD CONSTRAINT "FreezeSchedule_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RankingSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshot" ADD CONSTRAINT "RankingSnapshot_selectionCycleId_fkey" FOREIGN KEY ("selectionCycleId") REFERENCES "SelectionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshot" ADD CONSTRAINT "RankingSnapshot_weightVersionId_fkey" FOREIGN KEY ("weightVersionId") REFERENCES "WeightVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshot" ADD CONSTRAINT "RankingSnapshot_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "EligibilityRuleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshotEntry" ADD CONSTRAINT "RankingSnapshotEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RankingSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingSnapshotEntry" ADD CONSTRAINT "RankingSnapshotEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HopePepClassification" ADD CONSTRAINT "HopePepClassification_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HopePepClassification" ADD CONSTRAINT "HopePepClassification_selectionCycleId_fkey" FOREIGN KEY ("selectionCycleId") REFERENCES "SelectionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HopePepClassification" ADD CONSTRAINT "HopePepClassification_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RankingSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreAuditLog" ADD CONSTRAINT "ScoreAuditLog_selectionCycleId_fkey" FOREIGN KEY ("selectionCycleId") REFERENCES "SelectionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationJob" ADD CONSTRAINT "IntegrationJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "IntegrationSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationLog" ADD CONSTRAINT "IntegrationLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "IntegrationJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRecommendation" ADD CONSTRAINT "AgentRecommendation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

