import { Body, Controller, ForbiddenException, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { AuthPrincipal } from '../auth/auth.service';
import { ExternalScoresService } from './external-scores.service';
import { Source } from './mappers';
export class FetchScoresDto {
  @ApiPropertyOptional({enum:['ALL','SPEAKREADY','READINESS','INTERVIEW'],default:'ALL'})
  @IsOptional() @IsIn(['ALL','SPEAKREADY','READINESS','INTERVIEW']) source?:Source|'ALL';
  @ApiPropertyOptional({default:false}) @IsOptional() @IsBoolean() dryRun?:boolean;
}
@ApiTags('External score fetching') @ApiBearerAuth() @Controller('external-scores')
export class ExternalScoresController {
  constructor(private readonly scores:ExternalScoresService){}
  private authorize(user?:AuthPrincipal){if(!user||!['ADMIN','COORDINATOR'].includes(user.role))throw new ForbiddenException('Administrator or coordinator required');}
  @Get('status') status(@Req() request:{user:AuthPrincipal}){this.authorize(request.user);return this.scores.status();}
  @Post('fetch') fetch(@Body() input:FetchScoresDto,@Req() request:{user:AuthPrincipal}){this.authorize(request.user);return this.scores.sync(input.source??'ALL',input.dryRun??false);}
}
