import { Body, Controller, ForbiddenException, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CycleService } from './cycle.service';
import { CreateCycleConfigDto, UpdateCycleConfigDto } from './cycle.dto';

@ApiTags('Cycle Config')
@Controller('cycles')
export class CycleController {
  constructor(private readonly cycle: CycleService) {}

  @Post('config')
  @ApiOperation({ summary: 'Create Member 1 config for a selection cycle' })
  @ApiHeader({ name: 'x-role', required: true })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async createConfig(
    @Body() dto: CreateCycleConfigDto,
    @Headers('x-role') role: string,
    @Headers('x-actor-id') actorId: string,
  ) {
    this.assertPrivileged(role);
    return this.cycle.createConfig(
      dto.selectionCycleId,
      dto.hopeCount,
      dto.pepCount,
      actorId,
    );
  }

  @Patch('config/:selectionCycleId')
  @ApiOperation({ summary: 'Update cycle config (HOPE/PEP counts, active versions)' })
  @ApiHeader({ name: 'x-role', required: true })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async updateConfig(
    @Param('selectionCycleId') selectionCycleId: string,
    @Body() dto: UpdateCycleConfigDto,
    @Headers('x-role') role: string,
    @Headers('x-actor-id') actorId: string,
  ) {
    this.assertPrivileged(role);
    await this.cycle.updateConfig(selectionCycleId, dto, actorId);
    return this.cycle.getConfig(selectionCycleId);
  }

  @Get('config/:selectionCycleId')
  @ApiOperation({ summary: 'Get cycle config' })
  async getConfig(@Param('selectionCycleId') selectionCycleId: string) {
    return this.cycle.getConfig(selectionCycleId);
  }

  private assertPrivileged(role: string) {
    if (!['ADMIN', 'COORDINATOR'].includes(role)) {
      throw new ForbiddenException('Admin or coordinator role required');
    }
  }
}
