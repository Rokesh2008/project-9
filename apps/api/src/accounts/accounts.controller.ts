import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth.service';
import { CreateAccountDto, UpdateAccountDto } from './accounts.dto';
import { AccountsService } from './accounts.service';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get() list() { return this.accounts.list(); }
  @Get('options') options() { return this.accounts.options(); }
  @Post() create(@Body() body: CreateAccountDto) { return this.accounts.create(body); }
  @Patch(':id') update(@Param('id') id: string, @Body() body: UpdateAccountDto, @Req() request: { user: AuthPrincipal }) {
    return this.accounts.update(id, body, request.user.sub);
  }
}
