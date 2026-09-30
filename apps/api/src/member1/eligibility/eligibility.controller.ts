import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { EligibilityService } from './eligibility.service';
import {
  EvaluateEligibilityDto,
  CreateRuleVersionDto,
  ActivateRuleVersionDto,
} from './eligibility.dto';

@ApiTags('Eligibility')
@Controller('api/eligibility')
export class EligibilityController {
  constructor(private readonly eligibility: EligibilityService) {}

  @Post('evaluate')
  @ApiOperation({ summary: 'Evaluate eligibility for students in a cycle' })
  @ApiHeader({ name: 'x-role', required: true })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async evaluate(
    @Body() dto: EvaluateEligibilityDto,
    @Headers('x-actor-id') actorId: string,
  ) {
    return this.eligibility.evaluate(
      dto.selectionCycleId,
      dto.ruleVersionId,
      actorId,
      dto.studentId,
    );
  }

  @Post('rules')
  @ApiOperation({ summary: 'Create a new eligibility rule version' })
  @ApiHeader({ name: 'x-role', required: true })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async createRuleVersion(
    @Body() dto: CreateRuleVersionDto,
    @Headers('x-actor-id') actorId: string,
  ) {
    return this.eligibility.createRuleVersion({
      selectionCycleId: dto.selectionCycleId,
      rules: dto.rules,
      logic: dto.logic,
      description: dto.description,
      actorId,
    });
  }

  @Post('rules/activate')
  @ApiOperation({ summary: 'Activate a rule version for a cycle' })
  @ApiHeader({ name: 'x-role', required: true })
  @ApiHeader({ name: 'x-actor-id', required: true })
  async activateRuleVersion(
    @Body() dto: ActivateRuleVersionDto,
    @Headers('x-actor-id') actorId: string,
  ) {
    return this.eligibility.activateRuleVersion({
      selectionCycleId: dto.selectionCycleId,
      ruleVersionId: dto.ruleVersionId,
      actorId,
    });
  }

  @Get('rules/:selectionCycleId')
  @ApiOperation({ summary: 'Get all rule versions for a cycle' })
  async getRuleVersions(
    @Param('selectionCycleId') selectionCycleId: string,
  ) {
    return this.eligibility.getRuleVersions(selectionCycleId);
  }

  @Get(':selectionCycleId')
  @ApiOperation({ summary: 'Get eligibility results for a cycle' })
  async getByCycle(@Param('selectionCycleId') selectionCycleId: string) {
    return this.eligibility.getResultsByCycle(selectionCycleId);
  }

  @Get(':selectionCycleId/student/:studentId')
  @ApiOperation({ summary: 'Get eligibility result for a specific student' })
  async getForStudent(
    @Param('selectionCycleId') selectionCycleId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.eligibility.getResult(studentId, selectionCycleId);
  }
}
