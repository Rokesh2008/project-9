import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WorkflowState } from '@prisma/client';
import { IsString, IsOptional, IsArray, IsEnum } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { WorkflowService } from './workflow.service';

class AdvanceDto {
  @IsEnum(WorkflowState) targetState!: WorkflowState;
  @IsOptional() @IsString() reason?: string;
}

class BatchAdvanceDto {
  @IsEnum(WorkflowState) fromState!: WorkflowState;
  @IsEnum(WorkflowState) targetState!: WorkflowState;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) studentIds?: string[];
}

@ApiTags('Workflow')
@Controller('workflow')
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  @Get('status/:selectionCycleId/:studentId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  getStatus(
    @Param('selectionCycleId') selectionCycleId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.workflow.getStatus(studentId, selectionCycleId);
  }

  @Post('advance/:selectionCycleId/:studentId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  advance(
    @Param('selectionCycleId') selectionCycleId: string,
    @Param('studentId') studentId: string,
    @Body() dto: AdvanceDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.workflow.advanceState({
      studentId,
      selectionCycleId,
      targetState: dto.targetState,
      actor: user.id,
      role: user.role,
      reason: dto.reason,
    });
  }

  @Post('advance-batch/:selectionCycleId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  advanceBatch(
    @Param('selectionCycleId') selectionCycleId: string,
    @Body() dto: BatchAdvanceDto,
    @CurrentUser() user: { id: string; role: string },
  ) {
    return this.workflow.advanceBatch({
      selectionCycleId,
      fromState: dto.fromState,
      targetState: dto.targetState,
      actor: user.id,
      role: user.role,
      reason: dto.reason,
      studentIds: dto.studentIds,
    });
  }

  @Get('audit/:selectionCycleId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  auditTrail(
    @Param('selectionCycleId') selectionCycleId: string,
    @Query('studentId') studentId?: string,
  ) {
    return this.workflow.getAuditTrail(selectionCycleId, studentId);
  }

  @Get('summary/:selectionCycleId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  summary(@Param('selectionCycleId') selectionCycleId: string) {
    return this.workflow.getCycleSummary(selectionCycleId);
  }
}
