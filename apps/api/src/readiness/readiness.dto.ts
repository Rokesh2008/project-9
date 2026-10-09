import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class ReadinessParameterDto {
  @IsString() @IsNotEmpty() parameterKey!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(30) rawScore?: number | null;
  @IsEnum(['NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED']) verificationStatus!: 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
}

export class ReadinessRecordDto {
  @IsString() @IsNotEmpty() registerNumber!: string;
  @IsString() @IsNotEmpty() sourceResultId!: string;
  @IsISO8601() assessedAt!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(250) readinessScore?: number | null;
  @IsEnum(['PENDING', 'VERIFIED', 'REJECTED']) verificationStatus!: 'PENDING' | 'VERIFIED' | 'REJECTED';
  @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => ReadinessParameterDto) parameterScores!: ReadinessParameterDto[];
}

export class ReadinessImportDto {
  @IsString() @IsNotEmpty() sourceBatchId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ReadinessRecordDto) records!: ReadinessRecordDto[];
}
