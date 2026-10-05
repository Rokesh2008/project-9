import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { UnifiedAuditService } from './unified-audit.service';

@ApiTags('Audit')
@Roles('ADMIN')
@Controller('audit')
export class UnifiedAuditController {
  constructor(private readonly audit: UnifiedAuditService) {}

  @Get(':selectionCycleId')
  timeline(
    @Param('selectionCycleId') selectionCycleId: string,
    @Query('studentId') studentId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.audit.getTimeline({
      selectionCycleId,
      studentId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }
}
