import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { IntelligenceService } from './intelligence.service';

@Module({
  controllers: [AiController],
  providers: [AiService, IntelligenceService, PrismaService],
  exports: [AiService, IntelligenceService],
})
export class AiModule {}
