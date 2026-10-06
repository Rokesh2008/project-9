import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { AccountsController } from './accounts/accounts.controller';
import { AccountsService } from './accounts/accounts.service';
import { AgentService } from './agent.service';
import { AiService } from './ai.service';
import { AllocationController } from './allocation/allocation.controller';
import { AllocationService } from './allocation/allocation.service';
import { PrismaService } from './common/prisma.service';
import { AgentController, DemoController, HealthController, IntegrationsController, ReportsController, StudentsController } from './controllers';
import { DemoService } from './demo.service';
import { IntegrationsService } from './integrations.service';
import { IntelligenceService } from './intelligence.service';
import { Member1Module } from './member1/member1.module';
import { OfficialIntegrationService } from './official-integration.service';
import { OfficialReadService } from './official-read.service';
import { ReportsService } from './reports.service';
import { SelectionPipelineController } from './selection-pipeline.controller';
import { SelectionPipelineService } from './selection-pipeline.service';
import { Store } from './store';
import { ProfilesController } from './profiles/profiles.controller';
import { ProfilesService } from './profiles/profiles.service';

@Module({
  imports: [Member1Module],
  controllers: [HealthController, AuthController, AccountsController, ProfilesController, IntegrationsController, StudentsController, DemoController, AgentController, ReportsController, AllocationController, SelectionPipelineController],
  providers: [Store, IntegrationsService, OfficialIntegrationService, OfficialReadService, AiService, IntelligenceService, DemoService, AgentService, ReportsService, PrismaService, AllocationService, SelectionPipelineService, AuthService, AccountsService, ProfilesService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
