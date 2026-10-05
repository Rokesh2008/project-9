import {
  Controller,
  Post,
  Get,
  Param,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { EligibilityService } from './eligibility.service';
import {
  EvaluateEligibilityDto,
  CreateRuleVersionDto,
  ActivateRuleVersionDto,
} from './eligibility.dto';

@ApiTags('Eligibility')
@Controller('eligibility')
export class EligibilityController {
  constructor(private readonly eligibility: EligibilityService) {}

  @Post('evaluate')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  @ApiOperation({ summary: 'Evaluate eligibility for students in a cycle' })
  async evaluate(
    @Body() dto: EvaluateEligibilityDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.eligibility.evaluate(
      dto.selectionCycleId,
      dto.ruleVersionId,
      actorId,
      dto.studentId,
    );
  }

  @Post('rules')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  @ApiOperation({ summary: 'Create a new eligibility rule version' })
  async createRuleVersion(
    @Body() dto: CreateRuleVersionDto,
    @CurrentUser('id') actorId: string,
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
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  @ApiOperation({ summary: 'Activate a rule version for a cycle' })
  async activateRuleVersion(
    @Body() dto: ActivateRuleVersionDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.eligibility.activateRuleVersion({
      selectionCycleId: dto.selectionCycleId,
      ruleVersionId: dto.ruleVersionId,
      actorId,
    });
  }

  @Get('rules/:selectionCycleId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  @ApiOperation({ summary: 'Get all rule versions for a cycle' })
  async getRuleVersions(
    @Param('selectionCycleId') selectionCycleId: string,
  ) {
    return this.eligibility.getRuleVersions(selectionCycleId);
  }

  @Get(':selectionCycleId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  @ApiOperation({ summary: 'Get eligibility results for a cycle' })
  async getByCycle(@Param('selectionCycleId') selectionCycleId: string) {
    return this.eligibility.getResultsByCycle(selectionCycleId);
  }

  @Get(':selectionCycleId/student/:studentId')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  @ApiOperation({ summary: 'Get eligibility result for a specific student' })
  async getForStudent(
    @Param('selectionCycleId') selectionCycleId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.eligibility.getResult(studentId, selectionCycleId);
  }
}
