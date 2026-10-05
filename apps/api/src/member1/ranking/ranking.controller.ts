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
import { RankingService } from './ranking.service';
import { CalculateRankingDto, RankingQueryDto } from './ranking.dto';

@ApiTags('Ranking')
@Controller('ranking')
export class RankingController {
  constructor(private readonly ranking: RankingService) {}

  @Post('calculate')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  @ApiOperation({ summary: 'Calculate/recalculate the common live ranking for a cycle' })
  async calculate(
    @Body() dto: CalculateRankingDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.ranking.calculate(
      dto.selectionCycleId,
      dto.weightVersionId,
      actorId,
    );
  }

  @Get(':selectionCycleId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
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
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  @ApiOperation({ summary: 'Get rank for a specific student' })
  async getStudentRank(
    @Param('selectionCycleId') selectionCycleId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.ranking.getStudentRank(studentId, selectionCycleId);
  }
}
