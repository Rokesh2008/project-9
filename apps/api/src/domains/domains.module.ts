import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { DomainsController } from './domains.controller';
import { DomainsService } from './domains.service';

@Module({
  controllers: [DomainsController],
  providers: [DomainsService, PrismaService],
  exports: [DomainsService],
})
export class DomainsModule {}
