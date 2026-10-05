import { Controller, Post, Get, Patch, Param, Body, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { CycleService } from './cycle.service';
import { CreateCycleConfigDto, UpdateCycleConfigDto } from './cycle.dto';

@ApiTags('Cycle Config')
@Controller('api/cycles')
export class CycleController {
  constructor(private readonly cycle: CycleService) {}

  @Post('config')
  @ApiOperation({ summary: 'Create Member 1 config for a selection cycle' })
  @ApiHeader({ name: 'x-role', required: true })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async createConfig(
    @Body() _dto: CreateCycleConfigDto,
    @Headers('x-role') _role: string,
    @Headers('x-actor-id') _actorId: string,
  ) {
    // TODO: Implement in Prompt 04+
    throw new Error('Not implemented');
  }

  @Patch('config/:selectionCycleId')
  @ApiOperation({ summary: 'Update cycle config (HOPE/PEP counts, active versions)' })
  @ApiHeader({ name: 'x-role', required: true })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async updateConfig(
    @Param('selectionCycleId') _selectionCycleId: string,
    @Body() _dto: UpdateCycleConfigDto,
    @Headers('x-role') _role: string,
    @Headers('x-actor-id') _actorId: string,
  ) {
    // TODO: Implement in Prompt 04+
    throw new Error('Not implemented');
  }

  @Get('config/:selectionCycleId')
  @ApiOperation({ summary: 'Get cycle config' })
  async getConfig(
    @Param('selectionCycleId') _selectionCycleId: string,
  ) {
    // TODO: Implement in Prompt 04+
    throw new Error('Not implemented');
  }
}
