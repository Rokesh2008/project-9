import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { UnifiedAuditController } from './unified-audit.controller';
import { UnifiedAuditService } from './unified-audit.service';

@Module({
  controllers: [UnifiedAuditController],
  providers: [UnifiedAuditService, PrismaService],
  exports: [UnifiedAuditService],
})
export class UnifiedAuditModule {}
