import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { WeightsService } from './weights.service';
import { CreateWeightVersionDto, ActivateWeightVersionDto } from './weights.dto';

@ApiTags('Weights')
@Controller('weights')
export class WeightsController {
  constructor(private readonly weights: WeightsService) {}

  @Post('version')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  @ApiOperation({ summary: 'Create a new weight version' })
  async createVersion(
    @Body() dto: CreateWeightVersionDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.weights.createVersion(
      dto.selectionCycleId,
      dto.weights,
      actorId,
      dto.description,
    );
  }

  @Post('activate')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  @ApiOperation({ summary: 'Set the active weight version for a cycle' })
  async activate(
    @Body() dto: ActivateWeightVersionDto,
    @CurrentUser('id') actorId: string,
  ) {
    await this.weights.activate(
      dto.selectionCycleId,
      dto.weightVersionId,
      actorId,
    );
    return { success: true };
  }

  @Get(':selectionCycleId/versions')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  @ApiOperation({ summary: 'List all weight versions for a cycle' })
  async getVersions(
    @Param('selectionCycleId') selectionCycleId: string,
  ) {
    return this.weights.getVersions(selectionCycleId);
  }

  @Get(':selectionCycleId/active')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  @ApiOperation({ summary: 'Get the active weight version for a cycle' })
  async getActiveVersion(
    @Param('selectionCycleId') selectionCycleId: string,
  ) {
    return this.weights.getActiveVersion(selectionCycleId);
  }

  @Get('version/:weightVersionId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  @ApiOperation({ summary: 'Get a specific weight version with its parameters' })
  async getVersion(
    @Param('weightVersionId') weightVersionId: string,
  ) {
    return this.weights.getVersion(weightVersionId);
  }
}
