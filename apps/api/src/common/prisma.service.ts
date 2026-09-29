import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    // Connect lazily or if DATABASE_URL is provided
    if (process.env.DATABASE_URL) {
      try {
        await this.$connect();
      } catch (err) {
        // Log connection warning if database server is offline during standalone tests
        console.warn('Prisma could not connect to PostgreSQL immediately:', err instanceof Error ? err.message : String(err));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
