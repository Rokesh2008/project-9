import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AiService } from './ai.service';
import { AgentController, DemoController, HealthController, IntegrationsController, ReportsController, StudentsController } from './controllers';
import { DemoService } from './demo.service';
import { IntegrationsService } from './integrations.service';
import { IntelligenceService } from './intelligence.service';
import { ReportsService } from './reports.service';
import { Store } from './store';

@Module({
  controllers: [HealthController, IntegrationsController, StudentsController, DemoController, AgentController, ReportsController],
  providers: [Store, IntegrationsService, AiService, IntelligenceService, DemoService, AgentService, ReportsService],
})
export class AppModule {}
