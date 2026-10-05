import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

class StudentRecordDto {
  @IsString() studentId!: string;
  @IsString() registerNumber!: string;
  @IsString() name!: string;
  @IsString() department!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsNumber() @Min(0) @Max(10) cgpa!: number;
  @IsNumber() @Min(0) @Max(100) codingScore!: number;
  @IsNumber() @Min(0) @Max(100) aptitudeScore!: number;
  @IsNumber() @Min(0) @Max(100) attendancePercent!: number;
  @IsEnum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']) dsaLevel!: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) preferences!: string[];
  @IsArray() @IsString({ each: true }) completedCertificates!: string[];
  @IsOptional() @IsEnum(['PEP', 'HOPE', 'UNASSIGNED']) program?: 'PEP' | 'HOPE' | 'UNASSIGNED';
  @IsISO8601() sourceUpdatedAt!: string;
}

export class Project2ImportDto {
  @IsString() sourceBatchId!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => StudentRecordDto) records!: StudentRecordDto[];
}

export class CommunicationResultDto {
  @IsString() resultId!: string;
  @IsString() studentId!: string;
  @IsNumber() @Min(0) @Max(100) score!: number;
  @IsString() level!: string;
  @IsISO8601() assessedAt!: string;
}

export class Project1ResultsDto {
  @IsString() sourceBatchId!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => CommunicationResultDto) records!: CommunicationResultDto[];
}

export class InterviewResultDto {
  @IsString() attemptId!: string;
  @IsString() studentId!: string;
  @IsNumber() @Min(0) @Max(100) score!: number;
  @IsEnum(['PASS', 'FAIL', 'WAITLIST']) outcome!: 'PASS' | 'FAIL' | 'WAITLIST';
  @IsISO8601() interviewedAt!: string;
  @IsOptional() @IsString() notes?: string;
}

export class Project8ResultsDto {
  @IsString() sourceBatchId!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => InterviewResultDto) records!: InterviewResultDto[];
}

export class RunAgentDto {
  @IsOptional() @IsInt() @Min(1) cycleId?: number;
}

export class ApprovalDto {
  @IsString() approverId!: string;
  @IsEnum(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
}

export class WhatIfDto {
  @IsOptional() @IsNumber() @Min(0) @Max(100) codingScore?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) aptitudeScore?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(10) cgpa?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) attendancePercent?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) preferences?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) completedCertificates?: string[];
}
