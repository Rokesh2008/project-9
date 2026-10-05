import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApprovalDto, RunAgentDto } from '../dto';
import { AgentService } from './agent.service';

@ApiTags('Selection intelligence agent')
@Controller('agent/selection')
export class AgentController {
  constructor(@Inject(AgentService) private readonly agent: AgentService) {}

  @Post('run')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  run(@Body() _body: RunAgentDto) { return this.agent.run(); }

  @Get('recommendations')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR', 'PEP_STAFF')
  list() { return this.agent.list(); }

  @Post('recommendations/:id/decision')
  @Roles('ADMIN', 'PLACEMENT_COORDINATOR')
  decision(
    @Param('id') id: string,
    @Body() body: ApprovalDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.agent.approve(id, actorId, body.decision);
  }
}
