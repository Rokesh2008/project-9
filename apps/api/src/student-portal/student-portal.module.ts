import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StudentPortalController } from './student-portal.controller';
import { StudentPortalService } from './student-portal.service';

@Module({
  controllers: [StudentPortalController],
  providers: [StudentPortalService, PrismaService],
})
export class StudentPortalModule {}
