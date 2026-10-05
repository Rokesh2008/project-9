import { Injectable } from '@nestjs/common';
import { FreezeService } from './freeze.service';

@Injectable()
export class FreezeScheduler {
  constructor(private readonly freezeService: FreezeService) {}

  // TODO: Implement scheduled freeze execution in Prompt 04+
  // Will use @Cron or setInterval to check for due FreezeSchedules
}
