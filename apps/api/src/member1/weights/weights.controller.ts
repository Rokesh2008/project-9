import { Body, Controller, ForbiddenException, Get, Headers, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WeightsService } from './weights.service';
import { ActivateWeightVersionDto, CreateWeightVersionDto } from './weights.dto';

@ApiTags('Weights')
@Controller('weights')
export class WeightsController {
  constructor(private readonly weights: WeightsService) {}

  @Post('version')
  @ApiOperation({ summary: 'Create a new weight version' })
  @ApiHeader({ name: 'x-role', required: true })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async createVersion(
    @Body() dto: CreateWeightVersionDto,
    @Headers('x-role') role: string,
    @Headers('x-actor-id') actorId: string,
  ) {
    this.assertPrivileged(role);
    return this.weights.createVersion(
      dto.selectionCycleId,
      dto.weights,
      actorId,
      dto.description,
    );
  }

  @Post('activate')
  @ApiOperation({ summary: 'Set the active weight version for a cycle' })
  @ApiHeader({ name: 'x-role', required: true })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async activate(
    @Body() dto: ActivateWeightVersionDto,
    @Headers('x-role') role: string,
    @Headers('x-actor-id') actorId: string,
  ) {
    this.assertPrivileged(role);
    await this.weights.activate(dto.selectionCycleId, dto.weightVersionId, actorId);
    return this.weights.getActiveVersion(dto.selectionCycleId);
  }

  @Get(':selectionCycleId/versions')
  @ApiOperation({ summary: 'List all weight versions for a cycle' })
  async getVersions(@Param('selectionCycleId') selectionCycleId: string) {
    return this.weights.getVersions(selectionCycleId);
  }

  @Get(':selectionCycleId/active')
  @ApiOperation({ summary: 'Get the active weight version for a cycle' })
  async getActiveVersion(@Param('selectionCycleId') selectionCycleId: string) {
    return this.weights.getActiveVersion(selectionCycleId);
  }

  @Get('version/:weightVersionId')
  @ApiOperation({ summary: 'Get a specific weight version with its parameters' })
  async getVersion(@Param('weightVersionId') weightVersionId: string) {
    return this.weights.getVersion(weightVersionId);
  }

  private assertPrivileged(role: string) {
    if (!['ADMIN', 'COORDINATOR'].includes(role)) {
      throw new ForbiddenException('Admin or coordinator role required');
    }
  }
}
