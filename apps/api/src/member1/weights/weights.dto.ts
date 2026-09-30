import { IsString, IsOptional, IsArray, ValidateNested, IsNumber, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ParameterWeightDto {
  @ApiProperty()
  @IsString()
  parameterKey!: string;

  @ApiProperty()
  @IsString()
  parameterLabel!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  weight!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0.000001)
  maxRawScore!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class CreateWeightVersionDto {
  @ApiProperty()
  @IsString()
  selectionCycleId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ type: [ParameterWeightDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParameterWeightDto)
  weights!: ParameterWeightDto[];
}

export class ActivateWeightVersionDto {
  @ApiProperty()
  @IsString()
  selectionCycleId!: string;

  @ApiProperty()
  @IsString()
  weightVersionId!: string;
}
