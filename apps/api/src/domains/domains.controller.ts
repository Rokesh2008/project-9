import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { DomainsService } from './domains.service';

@ApiTags('Domains')
@Controller('domains')
export class DomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Get()
  findAll() {
    return this.domains.findAllDomains();
  }

  @Get('capacity')
  capacity() {
    return this.domains.getCapacitySummary();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.domains.findOneDomain(id);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: { programId: string; code: string; name: string; description?: string }) {
    return this.domains.createDomain(dto);
  }

  @Get('programs/list')
  programs() {
    return this.domains.findAllPrograms();
  }

  @Post('programs')
  @Roles('ADMIN')
  createProgram(@Body() dto: { code: string; name: string; description?: string }) {
    return this.domains.createProgram(dto);
  }

  @Post(':id/batches')
  @Roles('ADMIN')
  createBatch(
    @Param('id') domainId: string,
    @Body() dto: { batchCode: string; batchName: string; maxCapacity: number; startDate?: string; endDate?: string },
  ) {
    return this.domains.createTrainingBatch({ domainId, ...dto });
  }
}
