import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ScoringService } from './scoring.service';
import { CalculateStudentScoresDto, CalculateScoresDto } from './scoring.dto';

@ApiTags('Scoring')
@Controller('scoring')
export class ScoringController {
  constructor(private readonly scoring: ScoringService) {}

  @Post('calculate')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  @ApiOperation({
    summary: 'Calculate weighted scores for a student in a cycle',
  })
  async calculateStudentScores(
    @Body() dto: CalculateStudentScoresDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.scoring.calculateStudentScores(
      dto.selectionCycleId,
      dto.studentId,
      dto.parameterScores,
      actorId,
    );
  }

  @Post('calculate-batch')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  @ApiOperation({
    summary: 'Calculate weighted scores for all eligible students in a cycle using assessment data',
  })
  async calculateBatch(
    @Body() dto: CalculateScoresDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.scoring.calculateBatch(
      dto.selectionCycleId,
      actorId,
      dto.weightVersionId,
    );
  }

  @Get(':selectionCycleId/student/:studentId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  @ApiOperation({
    summary: 'Retrieve calculated scores for a student in a cycle',
  })
  async getStudentScores(
    @Param('selectionCycleId') selectionCycleId: string,
    @Param('studentId') studentId: string,
    @Query('weightVersionId') weightVersionId?: string,
  ) {
    return this.scoring.getStudentScores(
      studentId,
      selectionCycleId,
      weightVersionId,
    );
  }
}
