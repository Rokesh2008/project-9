import { IsString, IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCycleConfigDto {
  @ApiProperty()
  @IsString()
  selectionCycleId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  hopeCount!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  pepCount!: number;
}

export class UpdateCycleConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  hopeCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  pepCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  activeWeightVersionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  eligibilityRuleVersionId?: string;
}
