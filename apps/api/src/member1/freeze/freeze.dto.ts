import { IsString, IsDateString, IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ScheduleFreezeDto {
  @ApiProperty()
  @IsString()
  selectionCycleId!: string;

  @ApiProperty()
  @IsDateString()
  scheduledAt!: string;
}

export class ExecuteFreezeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CancelFreezeDto {
  @ApiProperty()
  @IsString()
  reason!: string;
}

export class PostponeFreezeDto {
  @ApiProperty()
  @IsDateString()
  newScheduledAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class RefreezeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CorrectSnapshotDto {
  @ApiProperty()
  @IsString()
  selectionCycleId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class SnapshotQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}
