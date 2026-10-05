import { Controller, Post, Get, Patch, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CycleService } from './cycle.service';
import { CreateCycleConfigDto, UpdateCycleConfigDto } from './cycle.dto';

@ApiTags('Cycle Config')
@Controller('cycles')
export class CycleController {
  constructor(private readonly cycle: CycleService) {}

  @Post('config')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create Member 1 config for a selection cycle' })
  async createConfig(
    @Body() dto: CreateCycleConfigDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.cycle.createConfig(
      dto.selectionCycleId,
      dto.hopeCount,
      dto.pepCount,
      actorId,
    );
  }

  @Patch('config/:selectionCycleId')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update cycle config (HOPE/PEP counts, active versions)' })
  async updateConfig(
    @Param('selectionCycleId') selectionCycleId: string,
    @Body() dto: UpdateCycleConfigDto,
    @CurrentUser('id') actorId: string,
  ) {
    await this.cycle.updateConfig(selectionCycleId, dto, actorId);
    return { success: true };
  }

  @Get('config/:selectionCycleId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  @ApiOperation({ summary: 'Get cycle config' })
  async getConfig(
    @Param('selectionCycleId') selectionCycleId: string,
  ) {
    return this.cycle.getConfig(selectionCycleId);
  }
}
