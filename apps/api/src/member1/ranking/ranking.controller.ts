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
import { RankingService } from './ranking.service';
import { CalculateRankingDto, RankingQueryDto } from './ranking.dto';

@ApiTags('Ranking')
@Controller('api/ranking')
export class RankingController {
  constructor(private readonly ranking: RankingService) {}

  @Post('calculate')
  @ApiOperation({ summary: 'Calculate/recalculate the common live ranking for a cycle' })
  @ApiHeader({ name: 'x-role', required: true })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async calculate(
    @Body() dto: CalculateRankingDto,
    @Headers('x-actor-id') actorId: string,
  ) {
    return this.ranking.calculate(
      dto.selectionCycleId,
      dto.weightVersionId,
      actorId,
    );
  }

  @Get(':selectionCycleId')
  @ApiOperation({ summary: 'Get the live ranking for a cycle' })
  async getLiveRanking(
    @Param('selectionCycleId') selectionCycleId: string,
    @Query() query: RankingQueryDto,
  ) {
    return this.ranking.getLiveRanking(
      selectionCycleId,
      query.page,
      query.pageSize,
    );
  }

  @Get(':selectionCycleId/student/:studentId')
  @ApiOperation({ summary: 'Get rank for a specific student' })
  async getStudentRank(
    @Param('selectionCycleId') selectionCycleId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.ranking.getStudentRank(studentId, selectionCycleId);
  }
}
