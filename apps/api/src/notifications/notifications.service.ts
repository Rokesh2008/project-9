import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(params: {
    recipient: string;
    recipientRole?: string;
    type: NotificationType;
    title: string;
    message: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
    metadata?: unknown;
  }) {
    return this.prisma.notification.create({
      data: {
        recipient: params.recipient,
        recipientRole: params.recipientRole,
        type: params.type,
        title: params.title,
        message: params.message,
        relatedEntityType: params.relatedEntityType,
        relatedEntityId: params.relatedEntityId,
        metadata: params.metadata as any,
      },
    });
  }

  async findForRecipient(recipient: string, unreadOnly = false) {
    const where: any = { recipient };
    if (unreadOnly) where.isRead = false;
    return this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async markRead(id: string) {
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(recipient: string) {
    return this.prisma.notification.updateMany({
      where: { recipient, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async countUnread(recipient: string) {
    return this.prisma.notification.count({
      where: { recipient, isRead: false },
    });
  }
}
