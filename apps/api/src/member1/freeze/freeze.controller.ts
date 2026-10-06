import { Controller, Post, Get, Param, Body, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
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
  @ApiOperation({ summary: 'Schedule a ranking freeze' })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async schedule(
    @Body() dto: ScheduleFreezeDto,
    @Headers('x-actor-id') actorId: string,
  ) {
    return this.freeze.schedule(
      dto.selectionCycleId,
      new Date(dto.scheduledAt),
      actorId,
    );
  }

  @Post(':selectionCycleId/execute')
  @ApiOperation({ summary: 'Execute freeze for a selection cycle' })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async execute(
    @Param('selectionCycleId') selectionCycleId: string,
    @Headers('x-actor-id') actorId: string,
    @Body() dto: ExecuteFreezeDto,
  ) {
    return this.freeze.executeFreeze(selectionCycleId, actorId, dto.reason);
  }

  @Post(':selectionCycleId/postpone')
  @ApiOperation({ summary: 'Postpone a scheduled freeze' })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async postpone(
    @Param('selectionCycleId') selectionCycleId: string,
    @Headers('x-actor-id') actorId: string,
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
  @ApiOperation({ summary: 'Cancel a scheduled freeze' })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async cancel(
    @Param('selectionCycleId') selectionCycleId: string,
    @Headers('x-actor-id') actorId: string,
    @Body() dto: CancelFreezeDto,
  ) {
    await this.freeze.cancel(selectionCycleId, actorId, dto.reason);
    return { success: true };
  }

  @Post(':selectionCycleId/refreeze')
  @ApiOperation({ summary: 'Critical re-freeze: create a new versioned snapshot while preserving the previous one' })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async refreeze(
    @Param('selectionCycleId') selectionCycleId: string,
    @Headers('x-actor-id') actorId: string,
    @Body() dto: RefreezeDto,
  ) {
    return this.freeze.refreeze(selectionCycleId, actorId, dto.reason);
  }

  @Get(':selectionCycleId')
  @ApiOperation({ summary: 'Get freeze schedules for a cycle' })
  async getSchedule(
    @Param('selectionCycleId') selectionCycleId: string,
  ) {
    return this.freeze.getSchedule(selectionCycleId);
  }

  @Get(':selectionCycleId/notifications')
  @ApiOperation({ summary: 'Get planned freeze notification events for a cycle' })
  async getNotifications(
    @Param('selectionCycleId') selectionCycleId: string,
  ) {
    return this.notifications.getEventsForCycle(selectionCycleId);
  }
}
