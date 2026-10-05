import { IsString, IsNumber, IsOptional, IsArray, IsBoolean, IsEmail, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateStudentDto {
  @ApiProperty() @IsString() studentId!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsEmail() email!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactNo?: string;
  @ApiProperty() @IsString() department!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() batch?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() academicYear?: string;
  @ApiProperty() @IsNumber() @Min(0) @Max(10) cgpa!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(100) codingScore!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(100) aptitudeScore!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(100) attendancePercent!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() dsaLevel?: string;
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) preferences?: string[];
  @ApiPropertyOptional() @IsOptional() @IsArray() @IsString({ each: true }) completedCertificates?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() program?: string;
}

export class StudentQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() department?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() program?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() page?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() pageSize?: number;
}
