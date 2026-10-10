import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { ReadinessImportDto } from './readiness.dto';
import { ReadinessService } from './readiness.service';

@ApiTags('Integrations')
@Controller('integrations/project2')
export class ReadinessController {
  constructor(private readonly readiness: ReadinessService) {}
  @Post('readiness')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  import(@Body() body: ReadinessImportDto, @Headers('idempotency-key') key: string) {
    return this.readiness.import(body, key);
  }
}
