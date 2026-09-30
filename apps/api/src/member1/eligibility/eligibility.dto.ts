import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsBoolean,
  IsInt,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import type { RuleOperator, RuleLogic } from './eligibility.engine';

export class EvaluateEligibilityDto {
  @ApiProperty()
  @IsString()
  selectionCycleId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ruleVersionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  studentId?: string;
}

export class EligibilityRuleDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty()
  @IsString()
  field!: string;

  @ApiProperty({ enum: ['GTE', 'LTE', 'GT', 'LT', 'EQ', 'NEQ', 'EXISTS', 'MIN_COUNT'] })
  @IsString()
  operator!: RuleOperator;

  @ApiPropertyOptional()
  @IsOptional()
  value?: unknown;
}

export class CreateRuleVersionDto {
  @ApiProperty()
  @IsString()
  selectionCycleId!: string;

  @ApiProperty({ type: [EligibilityRuleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EligibilityRuleDto)
  rules!: EligibilityRuleDto[];

  @ApiPropertyOptional({ enum: ['AND', 'OR'], default: 'AND' })
  @IsOptional()
  @IsString()
  logic?: RuleLogic;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class ActivateRuleVersionDto {
  @ApiProperty()
  @IsString()
  selectionCycleId!: string;

  @ApiProperty()
  @IsString()
  ruleVersionId!: string;
}

export class EligibilityResultDto {
  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  selectionCycleId!: string;

  @ApiProperty()
  isEligible!: boolean;

  @ApiPropertyOptional()
  failedRules?: Array<{
    ruleId: string;
    field: string;
    operator: string;
    expected: unknown;
    actual: unknown;
    message: string;
  }>;

  @ApiProperty()
  evaluatedAt!: string;

  @ApiPropertyOptional()
  ruleVersionId?: string;
}
