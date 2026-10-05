import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Inject,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AgentService } from './agent.service';
import { AiService } from './ai.service';
import { ApprovalDto, Project1ResultsDto, Project2ImportDto, Project8ResultsDto, RunAgentDto, WhatIfDto } from './dto';
import { DemoService } from './demo.service';
import { IntegrationsService } from './integrations.service';
import { IntelligenceService } from './intelligence.service';
import { ReportsService } from './reports.service';
import { Store } from './store';

@Controller()
export class HealthController {
  @Get('health') health() { return { status: 'ok', service: 'project9-member3-api' }; }
}

@ApiTags('Integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(@Inject(IntegrationsService) private readonly integrations: IntegrationsService) {}

  @Post('project2/students')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  project2(@Body() body: Project2ImportDto, @Headers('idempotency-key') key: string) {
    return this.integrations.importProject2(body, key);
  }

  @Get('project1/candidates')
  project1Candidates() { return this.integrations.exportProject1Candidates(); }

  @Post('project1/results')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  project1(@Body() body: Project1ResultsDto, @Headers('idempotency-key') key: string) {
    return this.integrations.importProject1(body, key);
  }

  @Get('project8/candidates')
  project8Candidates() { return this.integrations.exportProject8Candidates(); }

  @Post('project8/results')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  project8(@Body() body: Project8ResultsDto, @Headers('idempotency-key') key: string) {
    return this.integrations.importProject8(body, key);
  }

  @Post('import/excel')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5_000_000 } }))
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  spreadsheet(@UploadedFile() file: { buffer: Buffer; originalname: string }, @Headers('idempotency-key') key: string) {
    return this.integrations.importSpreadsheet(file.buffer, file.originalname, key);
  }

  @Get('templates/students.csv')
  @Header('content-type', 'text/csv')
  @Header('content-disposition', 'attachment; filename="project9-students-template.csv"')
  template(@Res() response: Response) { response.send(this.integrations.templateCsv()); }

  @Get('logs') logs() { return this.integrations.listLogs(); }
}

@ApiTags('Students and advisory AI')
@Controller()
export class StudentsController {
  constructor(
    @Inject(Store) private readonly store: Store,
    @Inject(AiService) private readonly ai: AiService,
    @Inject(IntelligenceService) private readonly intelligence: IntelligenceService,
  ) {}

  @Get('students') students() {
    return [...this.store.students.values()].map((student) => ({
      ...student,
      advisoryAnalysis: this.store.analyses.get(student.studentId),
      allocation: this.store.allocations.get(student.studentId),
    }));
  }

  @Get('students/:id') student(@Param('id') id: string) {
    return {
      student: this.store.students.get(id),
      analysis: this.store.analyses.get(id),
      communicationResults: [...this.store.communicationResults.values()].filter((r) => r.studentId === id),
      interviewAttempts: [...this.store.interviewResults.values()].filter((r) => r.studentId === id),
      allocation: this.store.allocations.get(id),
    };
  }

  @Post('ai/students/:id/analyze') analyze(@Param('id') id: string) { return this.ai.analyze(id); }
  @Post('ai/students/:id/what-if') whatIf(@Param('id') id: string, @Body() body: WhatIfDto) { return this.intelligence.whatIf(id, body); }
  @Get('ai/anomalies') anomalies() { return this.intelligence.anomalies(); }
}

@ApiTags('Standalone dependency simulator')
@Controller('demo')
export class DemoController {
  constructor(@Inject(DemoService) private readonly demo: DemoService) {}
  @Get('status') status() { return this.demo.status(); }
  @Post('bootstrap') bootstrap() { return this.demo.bootstrap(); }
  @Post('eligibility/evaluate') eligibility() { return this.demo.evaluateEligibility(); }
  @Post('project1/run') project1() { return this.demo.simulateProject1(); }
  @Post('project8/run') project8() { return this.demo.simulateProject8(); }
  @Post('run-dependency-simulation') all() { return this.demo.runDependencySimulation(); }
}

@ApiTags('Selection intelligence agent')
@Controller('agent/selection')
export class AgentController {
  constructor(@Inject(AgentService) private readonly agent: AgentService) {}

  @Post('run') run(@Body() _body: RunAgentDto) { return this.agent.run(); }
  @Get('recommendations') list() { return this.agent.list(); }
  @Post('recommendations/:id/decision') decision(
    @Param('id') id: string,
    @Body() body: ApprovalDto,
    @Headers('x-role') role: string,
  ) {
    if (!['ADMIN', 'PLACEMENT_COORDINATOR'].includes(role)) {
      throw new ForbiddenException('Authorized approval role required');
    }
    return this.agent.approve(id, body.approverId, body.decision);
  }
}

@ApiTags('Reports')
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
  selectionCsv(@Res() response: Response) { response.send(this.reports.selectionCsv()); }

  @Get('domain-capacity.csv')
  @Header('content-type', 'text/csv')
  @Header('content-disposition', 'attachment; filename="domain-capacity-report.csv"')
  capacityCsv(@Res() response: Response) { response.send(this.reports.capacityCsv()); }
}
