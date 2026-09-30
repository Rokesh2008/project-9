import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { AllocationService } from './allocation.service';
import { ApproveRejectDto, FreezeDto, GenerateAllocationsDto } from './allocation.dto';

@ApiTags('Allocations (Member 2)')
@Controller('allocations')
export class AllocationController {
  constructor(@Inject(AllocationService) private readonly service: AllocationService) {}

  @Post('generate')
  @ApiHeader({ name: 'x-actor-id', required: true })
  generate(@Body() body: GenerateAllocationsDto, @Headers('x-actor-id') actorId: string) {
    return this.service.generate(body.selectionCycleId, actorId ?? 'system');
  }

  @Get()
  findAll(@Query('selectionCycleId') selectionCycleId?: string) {
    return this.service.findAll(selectionCycleId);
  }

  @Get(':studentId')
  findByStudent(@Param('studentId') studentId: string) {
    return this.service.findByStudent(studentId);
  }

  @Post(':id/approve')
  @ApiHeader({ name: 'x-role', required: true })
  @ApiHeader({ name: 'x-actor-id', required: true })
  approve(
    @Param('id') id: string,
    @Body() body: ApproveRejectDto,
    @Headers('x-role') role: string,
  ) {
    return this.service.approve(id, body.actorId, role, body.reason);
  }

  @Post(':id/reject')
  @ApiHeader({ name: 'x-role', required: true })
  @ApiHeader({ name: 'x-actor-id', required: true })
  reject(
    @Param('id') id: string,
    @Body() body: ApproveRejectDto,
    @Headers('x-role') role: string,
  ) {
    return this.service.reject(id, body.actorId, role, body.reason);
  }

  @Post(':id/freeze')
  @ApiHeader({ name: 'x-role', required: true })
  freeze(
    @Param('id') id: string,
    @Body() body: FreezeDto,
    @Headers('x-role') role: string,
  ) {
    return this.service.freeze(id, body.actorId, role);
  }
}
