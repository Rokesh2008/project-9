import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StudentsModule } from '../students/students.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

@Module({
  imports: [StudentsModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, PrismaService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
