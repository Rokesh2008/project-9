import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  ServiceUnavailableException,
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
import { OfficialReadService } from './official-read.service';
import { ReportsService } from './reports.service';
import { Store } from './store';
import { AuthPrincipal } from './auth/auth.service';
import { PrismaService } from './common/prisma.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Get('health') health() { return { status: 'ok', service: 'project9-member3-api' }; }
  @Get('health/ready') async ready() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Readiness timeout')), 3000); })]);
      return { status: 'ready' };
    } catch { throw new ServiceUnavailableException('Database unavailable'); }
    finally { if (timer) clearTimeout(timer); }
  }
}

@ApiTags('Integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Post('project2/students')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  project2(@Body() body: Project2ImportDto, @Headers('idempotency-key') key: string) {
    return this.integrations.importProject2(body, key);
  }

  @Get('project1/candidates')
  project1Candidates(@Query('selectionCycleId') selectionCycleId?: string) {
    return this.integrations.exportProject1Candidates(selectionCycleId);
  }

  @Post('project1/results')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  project1(@Body() body: Project1ResultsDto, @Headers('idempotency-key') key: string) {
    return this.integrations.importProject1(body, key);
  }

  @Get('project8/candidates')
  project8Candidates(@Query('selectionCycleId') selectionCycleId?: string) {
    return this.integrations.exportProject8Candidates(selectionCycleId);
  }

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
    private readonly store: Store,
    private readonly ai: AiService,
    private readonly intelligence: IntelligenceService,
    private readonly official: OfficialReadService,
  ) {}

  @Get('students')
  async students() {
    const official = await this.official.listStudents();
    if (official) {
      return official.map((student) => ({
        ...student,
        advisoryAnalysis: this.store.analyses.get(student.studentId),
        allocation:
          student.allocation ?? this.store.allocations.get(student.studentId),
      }));
    }

    return [...this.store.students.values()].map((student) => ({
      ...student,
      advisoryAnalysis: this.store.analyses.get(student.studentId),
      allocation: this.store.allocations.get(student.studentId),
    }));
  }

  @Get('students/:id')
  async student(@Param('id') id: string) {
    const official = await this.official.getStudent(id);
    return {
      student: official ?? this.store.students.get(id),
      analysis: this.store.analyses.get(id),
      communicationResults: [...this.store.communicationResults.values()].filter(
        (result) => result.studentId === id,
      ),
      interviewAttempts: [...this.store.interviewResults.values()].filter(
        (result) => result.studentId === id,
      ),
      allocation:
        official?.allocation ?? this.store.allocations.get(id),
    };
  }

  @Post('ai/students/:id/analyze')
  analyze(@Param('id') id: string) { return this.ai.analyze(id); }

  @Post('ai/students/:id/what-if')
  whatIf(@Param('id') id: string, @Body() body: WhatIfDto) {
    return this.intelligence.whatIf(id, body);
  }

  @Get('ai/anomalies')
  anomalies() { return this.intelligence.anomalies(); }
}

@ApiTags('Standalone dependency simulator')
@Controller('demo')
export class DemoController {
  constructor(private readonly demo: DemoService) {}
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
  constructor(private readonly agent: AgentService) {}

  @Post('run') run(@Body() body: RunAgentDto) {
    return this.agent.run(body.selectionCycleId);
  }
  @Get('recommendations') list(@Req() request: { user?: AuthPrincipal }) { return this.agent.list(request.user); }
  @Post('recommendations/:id/decision') decision(
    @Param('id') id: string,
    @Body() body: ApprovalDto,
    @Headers('x-role') role: string,
    @Headers('x-actor-id') actorId: string,
    @Req() request: { user?: AuthPrincipal },
  ) {
    if (!['ADMIN', 'COORDINATOR', 'PEP_STAFF'].includes(role)) {
      throw new ForbiddenException('Authorized approval role required');
    }
    return this.agent.approve(id, actorId || body.approverId, body.decision, request.user);
  }
}

@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}
  @Get('selection-summary') summary() { return this.reports.selectionSummary(); }
  @Get('domain-capacity') capacity() { return this.reports.domainCapacity(); }
  @Get('eligibility-failures') failures() { return this.reports.eligibilityFailures(); }
  @Get('external-performance') performance() { return this.reports.performance(); }
  @Get('audit-trail') audit() { return this.reports.auditTrail(); }

  @Get('selection.csv')
  @Header('content-type', 'text/csv')
  @Header('content-disposition', 'attachment; filename="selection-report.csv"')
  async selectionCsv(@Res() response: Response) {
    response.send(await this.reports.selectionCsv());
  }

  @Get('domain-capacity.csv')
  @Header('content-type', 'text/csv')
  @Header('content-disposition', 'attachment; filename="domain-capacity-report.csv"')
  async capacityCsv(@Res() response: Response) {
    response.send(await this.reports.capacityCsv());
  }
}
