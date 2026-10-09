import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma.module';

import { AuditService } from './audit/audit.service';
import { EligibilityService } from './eligibility/eligibility.service';
import { EligibilityController } from './eligibility/eligibility.controller';
import { ScoringService } from './scoring/scoring.service';
import { ScoringController } from './scoring/scoring.controller';
import { RankingService } from './ranking/ranking.service';
import { RankingController } from './ranking/ranking.controller';
import { ClassificationService } from './classification/classification.service';
import { ClassificationController } from './classification/classification.controller';
import { FreezeService } from './freeze/freeze.service';
import { FreezeNotificationService } from './freeze/freeze-notification.service';
import { FreezeController } from './freeze/freeze.controller';
import { SnapshotController } from './freeze/snapshot.controller';
import { FreezeScheduler } from './freeze/freeze.scheduler';
import { WeightsService } from './weights/weights.service';
import { WeightsController } from './weights/weights.controller';
import { CycleService } from './cycle/cycle.service';
import { CycleController } from './cycle/cycle.controller';
import { SelectionResultService } from './selection/selection-result.service';
import { SelectionResultController } from './selection/selection-result.controller';
import { SelectionRulesService } from '../selection-rules/selection-rules.service';
import { SelectionRulesController } from '../selection-rules/selection-rules.controller';

@Module({
  imports: [PrismaModule],
  controllers: [
    SelectionRulesController,
    EligibilityController,
    ScoringController,
    RankingController,
    ClassificationController,
    FreezeController,
    SnapshotController,
    WeightsController,
    CycleController,
    SelectionResultController,
  ],
  providers: [
    SelectionRulesService,
    AuditService,
    EligibilityService,
    ScoringService,
    RankingService,
    ClassificationService,
    FreezeService,
    FreezeNotificationService,
    FreezeScheduler,
    WeightsService,
    CycleService,
    SelectionResultService,
  ],
  exports: [
    SelectionRulesService,
    EligibilityService,
    ScoringService,
    RankingService,
    ClassificationService,
    FreezeService,
    WeightsService,
    CycleService,
    SelectionResultService,
    AuditService,
  ],
})
export class Member1Module {}
