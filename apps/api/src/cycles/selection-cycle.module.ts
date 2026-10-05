import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { SelectionCycleController } from './selection-cycle.controller';
import { SelectionCycleService } from './selection-cycle.service';

@Module({
  controllers: [SelectionCycleController],
  providers: [SelectionCycleService, PrismaService],
  exports: [SelectionCycleService],
})
export class SelectionCycleModule {}
