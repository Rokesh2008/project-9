import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { SelectionCycleService } from './selection-cycle.service';

class CreateCycleDto {
  code!: string;
  name!: string;
  academicPeriod!: string;
  startDate!: string;
  endDate!: string;
}

@ApiTags('Selection Cycles')
@Controller('selection-cycles')
export class SelectionCycleController {
  constructor(private readonly cycles: SelectionCycleService) {}

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateCycleDto) {
    return this.cycles.create(dto);
  }

  @Get()
  findAll() {
    return this.cycles.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.cycles.findOne(id);
  }

  @Patch(':id/activate')
  @Roles('ADMIN')
  activate(@Param('id') id: string) {
    return this.cycles.activate(id);
  }

  @Patch(':id/complete')
  @Roles('ADMIN')
  complete(@Param('id') id: string) {
    return this.cycles.complete(id);
  }

  @Patch(':id/archive')
  @Roles('ADMIN')
  archive(@Param('id') id: string) {
    return this.cycles.archive(id);
  }
}
