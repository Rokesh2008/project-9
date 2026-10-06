import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { AllocationService } from './allocation.service';
import { ApproveRejectDto, FreezeDto, GenerateAllocationsDto } from './allocation.dto';
import { AuthPrincipal } from '../auth/auth.service';

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
  findAll(@Query('selectionCycleId') selectionCycleId?: string, @Req() request?: { user?: AuthPrincipal }) {
    return this.service.findAll(selectionCycleId, request?.user);
  }

  @Get(':studentId')
  findByStudent(@Param('studentId') studentId: string, @Req() request: { user?: AuthPrincipal }) {
    return this.service.findByStudent(studentId, request.user);
  }

  @Post(':id/approve')
  @ApiHeader({ name: 'x-role', required: true })
  @ApiHeader({ name: 'x-actor-id', required: true })
  approve(
    @Param('id') id: string,
    @Body() body: ApproveRejectDto,
    @Headers('x-role') role: string,
    @Headers('x-actor-id') headerActorId: string,
    @Req() request: { user?: AuthPrincipal },
  ) {
    return this.service.approve(id, headerActorId || body.actorId, role, body.reason, request.user?.facultyDomainId);
  }

  @Post(':id/reject')
  @ApiHeader({ name: 'x-role', required: true })
  @ApiHeader({ name: 'x-actor-id', required: true })
  reject(
    @Param('id') id: string,
    @Body() body: ApproveRejectDto,
    @Headers('x-role') role: string,
    @Headers('x-actor-id') headerActorId: string,
    @Req() request: { user?: AuthPrincipal },
  ) {
    return this.service.reject(id, headerActorId || body.actorId, role, body.reason, request.user?.facultyDomainId);
  }

  @Post(':id/freeze')
  @ApiHeader({ name: 'x-role', required: true })
  freeze(
    @Param('id') id: string,
    @Body() body: FreezeDto,
    @Headers('x-role') role: string,
    @Headers('x-actor-id') headerActorId: string,
  ) {
    return this.service.freeze(id, headerActorId || body.actorId, role);
  }
}
