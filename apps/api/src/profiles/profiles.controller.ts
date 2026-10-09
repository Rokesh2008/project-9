import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { AuthPrincipal } from '../auth/auth.service';
import { ProfilesService } from './profiles.service';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get() list(
    @Req() request: { user: AuthPrincipal },
    @Query('q') query?: string,
    @Query('page') page?: string,
    @Query('sort') sort?: string,
  ) {
    return this.profiles.listForStaff(request.user, query, Number(page ?? 1), sort);
  }

  @Get('me') mine(@Req() request: { user: AuthPrincipal }) {
    return this.profiles.mine(request.user);
  }

  @Get('roster-allocations') rosterAllocations(
    @Req() request: { user: AuthPrincipal }, @Query('q') query?: string,
    @Query('page') page?: string, @Query('group') group?: string,
  ) {
    return this.profiles.rosterAllocations(request.user, query, Number(page ?? 1), group);
  }

  @Get(':studentId') forStaff(@Param('studentId') studentId: string, @Req() request: { user: AuthPrincipal }) {
    return this.profiles.forStaff(studentId, request.user);
  }
}
