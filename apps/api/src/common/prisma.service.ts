import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { databaseContext } from './database-context';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    return new Proxy(this, {
      get(target, property, receiver) {
        const transaction = databaseContext.getStore();
        if (transaction && property === '$transaction') {
          return (work: unknown) => typeof work === 'function'
            ? work(transaction)
            : Promise.all(work as Promise<unknown>[]);
        }
        // Lifecycle/pool methods always belong to the root client.
        const source = transaction && property in transaction ? transaction : target;
        const value = Reflect.get(source, property, source === target ? receiver : source);
        return typeof value === 'function' ? value.bind(source) : value;
      },
    });
  }

  async atomic<T>(operation: () => Promise<T>): Promise<T> {
    if (databaseContext.getStore()) return operation();
    return this.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '8s'`;
      return databaseContext.run(tx, operation);
    }, {
      maxWait: 10_000, timeout: 120_000,
    });
  }

  async onModuleInit() {
    // Connect lazily or if DATABASE_URL is provided
    if (process.env.DATABASE_URL) {
      try {
        await this.$connect();
      } catch (err) {
        // Log connection warning if database server is offline during standalone tests
        console.warn('PostgreSQL connection unavailable during startup');
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
