import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AiModule } from '../ai/ai.module';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';

@Module({
  imports: [AiModule],
  controllers: [AgentController],
  providers: [AgentService, PrismaService],
  exports: [AgentService],
})
export class AgentModule {}
