import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AllocationService } from './allocation.service';
import { ApproveRejectDto, FreezeDto, GenerateAllocationsDto } from './allocation.dto';

@ApiTags('Allocations (Member 2)')
@Controller('allocations')
export class AllocationController {
  constructor(@Inject(AllocationService) private readonly service: AllocationService) {}

  @Post('generate')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  generate(@Body() body: GenerateAllocationsDto, @CurrentUser('id') actorId: string) {
    return this.service.generate(body.selectionCycleId, actorId);
  }

  @Get()
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  findAll(@Query('selectionCycleId') selectionCycleId?: string) {
    return this.service.findAll(selectionCycleId);
  }

  @Get(':studentId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  findByStudent(@Param('studentId') studentId: string) {
    return this.service.findByStudent(studentId);
  }

  @Post(':id/approve')
  @Roles('ADMIN')
  approve(
    @Param('id') id: string,
    @Body() body: ApproveRejectDto,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.service.approve(id, actorId, role, body.reason);
  }

  @Post(':id/reject')
  @Roles('ADMIN')
  reject(
    @Param('id') id: string,
    @Body() body: ApproveRejectDto,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.service.reject(id, actorId, role, body.reason);
  }

  @Post(':id/freeze')
  @Roles('ADMIN')
  freeze(
    @Param('id') id: string,
    @CurrentUser('id') actorId: string,
    @CurrentUser('role') role: string,
  ) {
    return this.service.freeze(id, actorId, role);
  }
}
