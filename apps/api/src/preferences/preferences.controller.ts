import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { PreferencesService } from './preferences.service';

@ApiTags('Preferences')
@Controller('preferences')
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  @Post(':studentId/:selectionCycleId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  set(
    @Param('studentId') studentId: string,
    @Param('selectionCycleId') selectionCycleId: string,
    @Body() dto: { preferences: Array<{ domainId: string; rank: number }> },
  ) {
    return this.preferences.setPreferences({
      studentId,
      selectionCycleId,
      preferences: dto.preferences,
    });
  }

  @Get(':studentId/:selectionCycleId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  get(
    @Param('studentId') studentId: string,
    @Param('selectionCycleId') selectionCycleId: string,
  ) {
    return this.preferences.getPreferences(studentId, selectionCycleId);
  }

  @Get('cycle/:selectionCycleId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  byCycle(@Param('selectionCycleId') selectionCycleId: string) {
    return this.preferences.getPreferencesByCycle(selectionCycleId);
  }
}
