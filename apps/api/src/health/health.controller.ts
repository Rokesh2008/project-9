import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';

@Public()
@Controller()
export class HealthController {
  @Get('health') health() { return { status: 'ok', service: 'project9-api' }; }
}
