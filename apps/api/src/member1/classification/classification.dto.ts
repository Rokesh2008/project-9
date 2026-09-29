import { IsString, IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CalculateClassificationDto {
  @ApiProperty()
  @IsString()
  selectionCycleId!: string;
}

export class ClassificationQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export class FallbackDecisionDto {
  @ApiProperty()
  @IsString()
  studentId!: string;

  @ApiProperty()
  @IsString()
  selectionCycleId!: string;

  @ApiProperty({ enum: ['PEP_FALLBACK_ALLOWED', 'PEP_FALLBACK_DENIED'] })
  @IsString()
  decision!: 'PEP_FALLBACK_ALLOWED' | 'PEP_FALLBACK_DENIED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
