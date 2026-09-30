-- CreateEnum
CREATE TYPE "FreezeNotificationEventType" AS ENUM ('FREEZE_SCHEDULED', 'FREEZE_7_DAYS_BEFORE', 'FREEZE_24_HOURS_BEFORE', 'FREEZE_1_HOUR_BEFORE', 'FREEZE_EXECUTED');

-- CreateEnum
CREATE TYPE "FreezeNotificationStatus" AS ENUM ('PENDING', 'SENT', 'CANCELLED', 'SKIPPED');

-- CreateTable
CREATE TABLE "FreezeNotificationEvent" (
    "id" TEXT NOT NULL,
    "selectionCycleId" TEXT NOT NULL,
    "freezeScheduleId" TEXT NOT NULL,
    "eventType" "FreezeNotificationEventType" NOT NULL,
    "plannedAt" TIMESTAMP(3) NOT NULL,
    "status" "FreezeNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreezeNotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FreezeNotificationEvent_freezeScheduleId_eventType_key" ON "FreezeNotificationEvent"("freezeScheduleId", "eventType");

-- CreateIndex
CREATE INDEX "FreezeNotificationEvent_selectionCycleId_idx" ON "FreezeNotificationEvent"("selectionCycleId");

-- CreateIndex
CREATE INDEX "FreezeNotificationEvent_freezeScheduleId_idx" ON "FreezeNotificationEvent"("freezeScheduleId");

-- CreateIndex
CREATE INDEX "FreezeNotificationEvent_status_plannedAt_idx" ON "FreezeNotificationEvent"("status", "plannedAt");

-- AddForeignKey
ALTER TABLE "FreezeNotificationEvent" ADD CONSTRAINT "FreezeNotificationEvent_selectionCycleId_fkey" FOREIGN KEY ("selectionCycleId") REFERENCES "SelectionCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreezeNotificationEvent" ADD CONSTRAINT "FreezeNotificationEvent_freezeScheduleId_fkey" FOREIGN KEY ("freezeScheduleId") REFERENCES "FreezeSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
