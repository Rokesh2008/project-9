import { Controller, Post, Get, Param, Body, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { WeightsService } from './weights.service';
import { CreateWeightVersionDto, ActivateWeightVersionDto } from './weights.dto';

@ApiTags('Weights')
@Controller('api/weights')
export class WeightsController {
  constructor(private readonly weights: WeightsService) {}

  @Post('version')
  @ApiOperation({ summary: 'Create a new weight version' })
  @ApiHeader({ name: 'x-role', required: true })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async createVersion(
    @Body() _dto: CreateWeightVersionDto,
    @Headers('x-role') _role: string,
    @Headers('x-actor-id') _actorId: string,
  ) {
    // TODO: Implement in Prompt 04+
    throw new Error('Not implemented');
  }

  @Post('activate')
  @ApiOperation({ summary: 'Set the active weight version for a cycle' })
  @ApiHeader({ name: 'x-role', required: true })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async activate(
    @Body() _dto: ActivateWeightVersionDto,
    @Headers('x-role') _role: string,
    @Headers('x-actor-id') _actorId: string,
  ) {
    // TODO: Implement in Prompt 04+
    throw new Error('Not implemented');
  }

  @Get(':selectionCycleId/versions')
  @ApiOperation({ summary: 'List all weight versions for a cycle' })
  async getVersions(
    @Param('selectionCycleId') _selectionCycleId: string,
  ) {
    // TODO: Implement in Prompt 04+
    throw new Error('Not implemented');
  }

  @Get(':selectionCycleId/active')
  @ApiOperation({ summary: 'Get the active weight version for a cycle' })
  async getActiveVersion(
    @Param('selectionCycleId') _selectionCycleId: string,
  ) {
    // TODO: Implement in Prompt 04+
    throw new Error('Not implemented');
  }

  @Get('version/:weightVersionId')
  @ApiOperation({ summary: 'Get a specific weight version with its parameters' })
  async getVersion(
    @Param('weightVersionId') _weightVersionId: string,
  ) {
    // TODO: Implement in Prompt 04+
    throw new Error('Not implemented');
  }
}
