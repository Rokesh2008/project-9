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
  @ApiOperation({ summary: 'Calculate HOPE/PEP classification from live ranking' })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async calculate(
    @Body() dto: CalculateClassificationDto,
    @Headers('x-actor-id') actorId: string,
  ) {
    return this.classification.calculate(dto.selectionCycleId, actorId);
  }

  @Post(':selectionCycleId/frozen')
  @ApiOperation({ summary: 'Calculate HOPE/PEP classification from frozen snapshot' })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async calculateFrozen(
    @Param('selectionCycleId') selectionCycleId: string,
    @Headers('x-actor-id') actorId: string,
  ) {
    return this.classification.calculateFrozenClassification(
      selectionCycleId,
      actorId,
    );
  }

  @Get(':selectionCycleId/authority')
  @ApiOperation({ summary: 'Resolve selection ranking authority (live vs frozen)' })
  async getAuthority(
    @Param('selectionCycleId') selectionCycleId: string,
  ) {
    return this.classification.resolveSelectionAuthority(selectionCycleId);
  }

  @Get(':selectionCycleId')
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
