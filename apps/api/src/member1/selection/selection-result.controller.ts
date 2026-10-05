import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { SelectionResultService } from './selection-result.service';

@ApiTags('Selection')
@Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
@Controller('selection')
export class SelectionResultController {
  constructor(private readonly selectionResult: SelectionResultService) {}

  @Get(':selectionCycleId/results')
  @ApiOperation({ summary: 'Get deterministic selection results for a cycle' })
  async getResults(
    @Param('selectionCycleId') selectionCycleId: string,
  ) {
    return this.selectionResult.getSelectionResults(selectionCycleId);
  }

  @Get(':selectionCycleId/results/:studentId')
  @ApiOperation({ summary: 'Get selection result for a specific student' })
  async getStudentResult(
    @Param('selectionCycleId') selectionCycleId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.selectionResult.getStudentSelectionResult(
      selectionCycleId,
      studentId,
    );
  }
}
