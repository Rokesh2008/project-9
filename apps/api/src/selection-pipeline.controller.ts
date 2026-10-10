import { Body, Controller, Get, Headers, Param, Post, Req } from '@nestjs/common';
import { AuthPrincipal } from './auth/auth.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { SelectionPipelineService } from './selection-pipeline.service';

class RunSelectionPipelineDto {
  @IsString()
  selectionCycleId!: string;
}

@ApiTags('Selection Pipeline')
@ApiBearerAuth()
@Controller('selection-pipeline')
export class SelectionPipelineController {
  constructor(private readonly pipeline: SelectionPipelineService) {}

  @Get('demo/:id')
  demoStatus(@Param('id') id: string) { return this.pipeline.demoStatus(id); }

  @Post('demo/:id/run')
  runDemo(@Param('id') id: string, @Req() request: {user: AuthPrincipal}) { return this.pipeline.runDemo(id, request.user?.sub ?? 'demo-test'); }

  @Post('run')
  @ApiOperation({
    summary:
      'Score all cycle students from configured source parameters, then run eligibility, ranking and classification',
  })
  run(
    @Body() body: RunSelectionPipelineDto,
    @Headers('x-actor-id') actorId = 'system',
  ) {
    return this.pipeline.run(body.selectionCycleId, actorId);
  }
}
