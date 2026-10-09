import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { EligibilityRuleDto } from '../member1/eligibility/eligibility.dto';

export class RulePolicyDto {
 @ApiProperty() @IsString() @IsNotEmpty() selectionCycleId!: string;
 @ApiPropertyOptional({nullable:true}) @IsOptional() @IsString() domainId?: string | null;
 @ApiProperty({enum:['BOTH','HOPE','PEP']}) @IsEnum(['BOTH','HOPE','PEP']) program!: 'BOTH'|'HOPE'|'PEP';
 @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
 @ApiProperty({enum:['AND','OR']}) @IsEnum(['AND','OR']) logic!: 'AND'|'OR';
 @ApiProperty({type:[EligibilityRuleDto]}) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({each:true}) @Type(()=>EligibilityRuleDto) rules!: EligibilityRuleDto[];
}
export class PreviewRulePolicyDto extends RulePolicyDto {
 @ApiProperty() @IsString() @IsNotEmpty() registerNumber!: string;
}
