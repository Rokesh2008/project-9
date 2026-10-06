import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { AuthService, AuthPrincipal } from './auth.service';
import { BootstrapAdminDto, LoginDto } from './auth.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() body: LoginDto) {
    return this.auth.login(body.email, body.password);
  }

  @Post('bootstrap')
  @ApiHeader({ name: 'x-bootstrap-key', required: true })
  bootstrap(
    @Body() body: BootstrapAdminDto,
    @Headers('x-bootstrap-key') bootstrapKey: string,
  ) {
    return this.auth.bootstrapAdmin(
      body.name,
      body.email,
      body.password,
      bootstrapKey,
    );
  }

  @Get('me')
  @ApiBearerAuth()
  me(@Req() request: { user?: AuthPrincipal }) {
    if (!request.user) {
      throw new UnauthorizedException('Bearer token required');
    }
    return request.user;
  }
}
