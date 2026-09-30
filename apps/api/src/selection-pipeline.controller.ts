import { Body, Controller, Headers, Post } from '@nestjs/common';
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
