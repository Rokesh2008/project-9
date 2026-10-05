import {
  Controller,
  Get,
  Header,
  Inject,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
@Controller('reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}
  @Get('selection-summary') summary() { return this.reports.selectionSummary(); }
  @Get('domain-capacity') capacity() { return this.reports.domainCapacity(); }
  @Get('eligibility-failures') failures() { return this.reports.eligibilityFailures(); }
  @Get('external-performance') performance() { return this.reports.performance(); }
  @Get('audit-trail') audit() { return this.reports.auditTrail(); }

  @Get('selection.csv')
  @Header('content-type', 'text/csv')
  @Header('content-disposition', 'attachment; filename="selection-report.csv"')
  async selectionCsv(@Res() response: Response) { response.send(await this.reports.selectionCsv()); }

  @Get('domain-capacity.csv')
  @Header('content-type', 'text/csv')
  @Header('content-disposition', 'attachment; filename="domain-capacity-report.csv"')
  async capacityCsv(@Res() response: Response) { response.send(await this.reports.capacityCsv()); }
}
