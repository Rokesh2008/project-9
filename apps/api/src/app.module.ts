import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AgentModule } from './agent/agent.module';
import { AiModule } from './ai/ai.module';
import { AllocationModule } from './allocation/allocation.module';
import { UnifiedAuditModule } from './audit/unified-audit.module';
import { AuthModule } from './auth/auth.module';
import { PrismaService } from './common/prisma.service';
import { SelectionCycleModule } from './cycles/selection-cycle.module';
import { DomainsModule } from './domains/domains.module';
import { HealthModule } from './health/health.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { Member1Module } from './member1/member1.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PreferencesModule } from './preferences/preferences.module';
import { ReportsModule } from './reports/reports.module';
import { StudentPortalModule } from './student-portal/student-portal.module';
import { StudentsModule } from './students/students.module';
import { WorkflowModule } from './workflow/workflow.module';

@Module({
  imports: [
    Member1Module,
    AllocationModule,
    AuthModule,
    StudentsModule,
    WorkflowModule,
    SelectionCycleModule,
    DomainsModule,
    PreferencesModule,
    UnifiedAuditModule,
    NotificationsModule,
    HealthModule,
    IntegrationsModule,
    AiModule,
    AgentModule,
    ReportsModule,
    StudentPortalModule,
    AdminModule,
  ],
  providers: [PrismaService],
})
export class AppModule {}
