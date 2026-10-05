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
import { ClassificationService } from './classification.service';
import {
  CalculateClassificationDto,
  ClassificationQueryDto,
} from './classification.dto';

@ApiTags('Classification')
@Controller('classification')
export class ClassificationController {
  constructor(private readonly classification: ClassificationService) {}

  @Post('calculate')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  @ApiOperation({ summary: 'Calculate HOPE/PEP classification from live ranking' })
  async calculate(
    @Body() dto: CalculateClassificationDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.classification.calculate(dto.selectionCycleId, actorId);
  }

  @Post(':selectionCycleId/frozen')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  @ApiOperation({ summary: 'Calculate HOPE/PEP classification from frozen snapshot' })
  async calculateFrozen(
    @Param('selectionCycleId') selectionCycleId: string,
    @CurrentUser('id') actorId: string,
  ) {
    return this.classification.calculateFrozenClassification(
      selectionCycleId,
      actorId,
    );
  }

  @Get(':selectionCycleId/authority')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  @ApiOperation({ summary: 'Resolve selection ranking authority (live vs frozen)' })
  async getAuthority(
    @Param('selectionCycleId') selectionCycleId: string,
  ) {
    return this.classification.resolveSelectionAuthority(selectionCycleId);
  }

  @Get(':selectionCycleId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  @ApiOperation({ summary: 'Get classifications for a cycle' })
  async getClassifications(
    @Param('selectionCycleId') selectionCycleId: string,
    @Query() query: ClassificationQueryDto,
  ) {
    return this.classification.getClassifications(
      selectionCycleId,
      query.page,
      query.pageSize,
    );
  }

  @Get(':selectionCycleId/student/:studentId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  @ApiOperation({ summary: 'Get classification for a specific student' })
  async getStudentClassification(
    @Param('selectionCycleId') selectionCycleId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.classification.getStudentClassification(
      studentId,
      selectionCycleId,
    );
  }
}
