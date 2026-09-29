import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { AllocationController } from './allocation.controller';
import { AllocationService } from './allocation.service';

@Module({
  controllers: [AllocationController],
  providers: [AllocationService, PrismaService],
})
export class AllocationModule {}
