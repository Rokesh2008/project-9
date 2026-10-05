import { IsEnum, IsOptional, IsString } from 'class-validator';

export class GenerateAllocationsDto {
  @IsString() selectionCycleId!: string;
}

export class ApproveRejectDto {
  @IsString() actorId!: string;
  @IsString() reason!: string;
}

export class FreezeDto {
  @IsString() actorId!: string;
}
