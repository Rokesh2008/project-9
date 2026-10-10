import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthPrincipal } from '../auth/auth.service';
import { RulePolicyDto, PreviewRulePolicyDto } from './selection-rules.dto';
import { SelectionRulesService } from './selection-rules.service';
@ApiTags('Custom selection rules') @ApiBearerAuth() @Controller('selection-rules')
export class SelectionRulesController {
 constructor(private readonly rules:SelectionRulesService){}
 @Get('options') options(@Req() r:{user:AuthPrincipal}){return this.rules.metadata(r.user);}
 @Get('cycles/:id') list(@Param('id') id:string,@Req() r:{user:AuthPrincipal}){return this.rules.list(id,r.user);}
 @Post() create(@Body() d:RulePolicyDto,@Req() r:{user:AuthPrincipal}){return this.rules.create(d,r.user);}
 @Post('preview') preview(@Body() d:PreviewRulePolicyDto,@Req() r:{user:AuthPrincipal}){return this.rules.preview(d,r.user);}
 @Post(':id/activate') activate(@Param('id') id:string,@Req() r:{user:AuthPrincipal}){return this.rules.setActive(id,true,r.user);}
 @Post(':id/deactivate') deactivate(@Param('id') id:string,@Req() r:{user:AuthPrincipal}){return this.rules.setActive(id,false,r.user);}
}
