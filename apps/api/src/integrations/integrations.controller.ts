import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import type { Response } from 'express';
import { Project1ResultsDto, Project2ImportDto, Project8ResultsDto } from '../dto';
import { IntegrationsService } from './integrations.service';

@ApiTags('Integrations')
@Roles('ADMIN', 'PLACEMENT_COORDINATOR')
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
