import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ParameterScoreInputDto {
  @ApiProperty({ description: 'Configuration-driven parameter key' })
  @IsString()
  parameterKey!: string;

  @ApiPropertyOptional({
    description: 'Raw score value. Null or omitted = missing score.',
  })
  @IsOptional()
  @IsNumber()
  rawScore?: number | null;
}

export class CalculateStudentScoresDto {
  @ApiProperty()
  @IsString()
  selectionCycleId!: string;

  @ApiProperty()
  @IsString()
  studentId!: string;

  @ApiProperty({ type: [ParameterScoreInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParameterScoreInputDto)
  parameterScores!: ParameterScoreInputDto[];
}

export class CalculateScoresDto {
  @ApiProperty()
  @IsString()
  selectionCycleId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  weightVersionId?: string;
}
