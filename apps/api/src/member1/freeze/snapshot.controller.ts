import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { FreezeService } from './freeze.service';
import { SnapshotQueryDto } from './freeze.dto';

@ApiTags('Snapshot')
@Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
@Controller('snapshot')
export class SnapshotController {
  constructor(private readonly freeze: FreezeService) {}

  @Get(':selectionCycleId')
  @ApiOperation({ summary: 'List all snapshots for a selection cycle' })
  async getSnapshots(
    @Param('selectionCycleId') selectionCycleId: string,
  ) {
    return this.freeze.getSnapshots(selectionCycleId);
  }

  @Get(':selectionCycleId/latest')
  @ApiOperation({ summary: 'Get the latest snapshot for a selection cycle' })
  async getLatestSnapshot(
    @Param('selectionCycleId') selectionCycleId: string,
  ) {
    return this.freeze.getLatestSnapshot(selectionCycleId);
  }

  @Get(':selectionCycleId/:snapshotId')
  @ApiOperation({ summary: 'Get a specific snapshot' })
  async getSnapshot(
    @Param('selectionCycleId') selectionCycleId: string,
    @Param('snapshotId') snapshotId: string,
  ) {
    return this.freeze.getSnapshot(selectionCycleId, snapshotId);
  }

  @Get(':selectionCycleId/:snapshotId/students')
  @ApiOperation({ summary: 'Get student entries for a snapshot' })
  async getSnapshotStudents(
    @Param('selectionCycleId') selectionCycleId: string,
    @Param('snapshotId') snapshotId: string,
    @Query() query: SnapshotQueryDto,
  ) {
    return this.freeze.getSnapshotStudents(
      selectionCycleId,
      snapshotId,
      query.page ?? 1,
      query.pageSize ?? 50,
    );
  }
}
