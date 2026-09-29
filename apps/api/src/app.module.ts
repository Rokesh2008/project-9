import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AiService } from './ai.service';
import { AllocationController } from './allocation/allocation.controller';
import { AllocationService } from './allocation/allocation.service';
import { PrismaService } from './common/prisma.service';
import { AgentController, DemoController, HealthController, IntegrationsController, ReportsController, StudentsController } from './controllers';
import { DemoService } from './demo.service';
import { IntegrationsService } from './integrations.service';
import { IntelligenceService } from './intelligence.service';
import { ReportsService } from './reports.service';
import { Store } from './store';

@Module({
  controllers: [HealthController, IntegrationsController, StudentsController, DemoController, AgentController, ReportsController, AllocationController],
  providers: [Store, IntegrationsService, AiService, IntelligenceService, DemoService, AgentService, ReportsService, PrismaService, AllocationService],
})
export class AppModule {}
