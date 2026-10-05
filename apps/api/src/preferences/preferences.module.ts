import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';

@Module({
  controllers: [PreferencesController],
  providers: [PreferencesService, PrismaService],
  exports: [PreferencesService],
})
export class PreferencesModule {}
