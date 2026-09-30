import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { ScoringService } from './scoring.service';
import { CalculateStudentScoresDto } from './scoring.dto';

@ApiTags('Scoring')
@Controller('scoring')
export class ScoringController {
  constructor(private readonly scoring: ScoringService) {}

  @Post('calculate')
  @ApiOperation({
    summary: 'Calculate weighted scores for a student in a cycle',
  })
  @ApiHeader({ name: 'x-role', required: true })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async calculateStudentScores(
    @Body() dto: CalculateStudentScoresDto,
    @Headers('x-actor-id') actorId: string,
  ) {
    return this.scoring.calculateStudentScores(
      dto.selectionCycleId,
      dto.studentId,
      dto.parameterScores,
      actorId,
    );
  }

  @Get(':selectionCycleId/student/:studentId')
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
