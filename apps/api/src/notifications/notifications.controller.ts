import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get(':recipient')
  findAll(
    @Param('recipient') recipient: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notifications.findForRecipient(recipient, unreadOnly === 'true');
  }

  @Get(':recipient/count')
  count(@Param('recipient') recipient: string) {
    return this.notifications.countUnread(recipient);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string) {
    return this.notifications.markRead(id);
  }

  @Patch(':recipient/read-all')
  markAllRead(@Param('recipient') recipient: string) {
    return this.notifications.markAllRead(recipient);
  }
}
