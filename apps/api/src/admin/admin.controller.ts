import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminService } from './admin.service';

@ApiTags('Admin')
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  listUsers() {
    return this.admin.listUsers();
  }

  @Post('users')
  createUser(@Body() body: { email: string; password: string; name: string; role: string; studentId?: string }) {
    return this.admin.createUser(body);
  }

  @Patch('users/:id/role')
  updateRole(@Param('id') id: string, @Body() body: { role: string }) {
    return this.admin.updateRole(id, body.role);
  }

  @Patch('users/:id/status')
  updateStatus(@Param('id') id: string, @Body() body: { isActive: boolean }) {
    return this.admin.updateStatus(id, body.isActive);
  }
}
