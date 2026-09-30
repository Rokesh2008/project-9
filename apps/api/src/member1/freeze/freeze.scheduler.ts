import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { FreezeService } from './freeze.service';

@Injectable()
export class FreezeScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FreezeScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly freezeService: FreezeService) {}

  onModuleInit() {
    if ((process.env.ENABLE_FREEZE_SCHEDULER ?? 'false').toLowerCase() !== 'true') {
      return;
    }

    const configured = Number(process.env.FREEZE_SCHEDULER_INTERVAL_MS ?? 30000);
    const intervalMs = Number.isFinite(configured) && configured >= 1000 ? configured : 30000;

    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
    void this.tick();
    this.logger.log(`Freeze scheduler enabled (interval: ${intervalMs}ms)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;

    try {
      const result = await this.freezeService.processDueFreezes();
      if (result.dueCount > 0) {
        this.logger.log(
          `Processed ${result.dueCount} due freeze(s): ${result.executedCount} executed, ${result.failedCount} failed`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Freeze scheduler tick failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
