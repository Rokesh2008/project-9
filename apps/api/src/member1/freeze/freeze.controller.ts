import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { FreezeService } from './freeze.service';
import { FreezeNotificationService } from './freeze-notification.service';
import { ScheduleFreezeDto, CancelFreezeDto, ExecuteFreezeDto, PostponeFreezeDto, RefreezeDto } from './freeze.dto';

@ApiTags('Freeze')
@Controller('freeze')
export class FreezeController {
  constructor(
    private readonly freeze: FreezeService,
    private readonly notifications: FreezeNotificationService,
  ) {}

  @Post('schedule')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  @ApiOperation({ summary: 'Schedule a ranking freeze' })
  async schedule(
    @Body() dto: ScheduleFreezeDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.freeze.schedule(
      dto.selectionCycleId,
      new Date(dto.scheduledAt),
      actorId,
    );
  }

  @Post(':selectionCycleId/execute')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  @ApiOperation({ summary: 'Execute freeze for a selection cycle' })
  async execute(
    @Param('selectionCycleId') selectionCycleId: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: ExecuteFreezeDto,
  ) {
    return this.freeze.executeFreeze(selectionCycleId, actorId, dto.reason);
  }

  @Post(':selectionCycleId/postpone')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  @ApiOperation({ summary: 'Postpone a scheduled freeze' })
  async postpone(
    @Param('selectionCycleId') selectionCycleId: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: PostponeFreezeDto,
  ) {
    return this.freeze.postpone(
      selectionCycleId,
      new Date(dto.newScheduledAt),
      actorId,
      dto.reason,
    );
  }

  @Post(':selectionCycleId/cancel')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  @ApiOperation({ summary: 'Cancel a scheduled freeze' })
  async cancel(
    @Param('selectionCycleId') selectionCycleId: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: CancelFreezeDto,
  ) {
    await this.freeze.cancel(selectionCycleId, actorId, dto.reason);
    return { success: true };
  }

  @Post(':selectionCycleId/refreeze')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  @ApiOperation({ summary: 'Critical re-freeze: create a new versioned snapshot while preserving the previous one' })
  async refreeze(
    @Param('selectionCycleId') selectionCycleId: string,
    @CurrentUser('id') actorId: string,
    @Body() dto: RefreezeDto,
  ) {
    return this.freeze.refreeze(selectionCycleId, actorId, dto.reason);
  }

  @Get(':selectionCycleId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  @ApiOperation({ summary: 'Get freeze schedules for a cycle' })
  async getSchedule(
    @Param('selectionCycleId') selectionCycleId: string,
  ) {
    return this.freeze.getSchedule(selectionCycleId);
  }

  @Get(':selectionCycleId/notifications')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  @ApiOperation({ summary: 'Get planned freeze notification events for a cycle' })
  async getNotifications(
    @Param('selectionCycleId') selectionCycleId: string,
  ) {
    return this.notifications.getEventsForCycle(selectionCycleId);
  }
}
