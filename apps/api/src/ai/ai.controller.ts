import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { WhatIfDto } from '../dto';
import { AiService } from './ai.service';
import { IntelligenceService } from './intelligence.service';

@ApiTags('Advisory AI')
@Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
@Controller()
export class AiController {
  constructor(
    @Inject(AiService) private readonly ai: AiService,
    @Inject(IntelligenceService) private readonly intelligence: IntelligenceService,
  ) {}

  @Post('ai/students/:id/analyze') analyze(@Param('id') id: string) { return this.ai.analyze(id); }
  @Post('ai/students/:id/what-if') whatIf(@Param('id') id: string, @Body() body: WhatIfDto) { return this.intelligence.whatIf(id, body); }
  @Get('ai/anomalies') anomalies() { return this.intelligence.anomalies(); }
}
