import {
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'crypto';
import { PrismaService } from '../common/prisma.service';

export interface AuthPrincipal {
  sub: string;
  email: string;
  role: Role;
  iat: number;
  exp: number;
  ver?: number;
  studentId?: string | null;
  facultyDomainId?: string | null;
  facultyDomainCode?: string | null;
  facultyDomainName?: string | null;
  loginIdentifier?: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(email: string, password: string) {
    const identifier = email.trim();
    // Register-number login resolves only the account linked to that student.
    // Do not fall back to names or serial numbers, which are not unique identifiers.
    const student = !identifier.includes('@')
      ? await this.prisma.student.findUnique({ where: { registerNumber: identifier.toUpperCase() }, include: { user: true } })
      : null;
    const user = identifier.includes('@')
      ? await this.prisma.user.findUnique({ where: { email: identifier.toLowerCase() } })
      : student?.isActive && student.user?.role === 'STUDENT' ? student.user : null;
    if (!user || !user.isActive || !this.verifyPassword(password, user.password)) {
      throw new UnauthorizedException('Invalid login ID or password');
    }

    const token = this.signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      ver: user.authVersion,
    });
    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: this.tokenTtlSeconds(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        studentId: user.studentId,
        facultyDomainId: user.facultyDomainId,
      },
    };
  }

  async bootstrapAdmin(
    name: string,
    email: string,
    password: string,
    bootstrapKey: string,
  ) {
    const configured = process.env.ADMIN_BOOTSTRAP_KEY;
    if (!configured || !this.safeEqual(bootstrapKey, configured)) {
      throw new ForbiddenException('Invalid bootstrap key');
    }

    const existingAdmin = await this.prisma.user.findFirst({
      where: { role: 'ADMIN', isActive: true },
    });
    if (existingAdmin) {
      throw new ConflictException('An active administrator already exists');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      const user = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          name,
          password: this.hashPassword(password),
          role: 'ADMIN',
          isActive: true,
          authVersion: { increment: 1 },
        },
      });
      return { id: user.id, email: user.email, role: user.role };
    }

    const user = await this.prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        password: this.hashPassword(password),
        role: 'ADMIN',
      },
    });
    return { id: user.id, email: user.email, role: user.role };
  }

  signToken(input: { sub: string; email: string; role: Role; ver: number }) {
    const now = Math.floor(Date.now() / 1000);
    const payload: AuthPrincipal = {
      ...input,
      iat: now,
      exp: now + this.tokenTtlSeconds(),
    };
    const header = this.base64Url(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    );
    const body = this.base64Url(JSON.stringify(payload));
    const signature = this.signature(`${header}.${body}`);
    return `${header}.${body}.${signature}`;
  }

  verifyToken(token: string): AuthPrincipal {
    const [header, body, suppliedSignature, extra] = token.split('.');
    if (!header || !body || !suppliedSignature || extra) {
      throw new UnauthorizedException('Malformed bearer token');
    }

    const expectedSignature = this.signature(`${header}.${body}`);
    if (!this.safeEqual(suppliedSignature, expectedSignature)) {
      throw new UnauthorizedException('Invalid bearer token');
    }

    let principal: AuthPrincipal;
    try {
      principal = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as AuthPrincipal;
    } catch {
      throw new UnauthorizedException('Invalid bearer token payload');
    }

    const now = Math.floor(Date.now() / 1000);
    if (!principal.sub || !principal.email || !principal.role || principal.exp <= now) {
      throw new UnauthorizedException('Bearer token has expired or is invalid');
    }
    if (!Object.values(Role).includes(principal.role)) {
      throw new UnauthorizedException('Bearer token role is invalid');
    }
    return principal;
  }

  extractBearer(value?: string): AuthPrincipal | null {
    if (!value?.startsWith('Bearer ')) return null;
    return this.verifyToken(value.slice('Bearer '.length).trim());
  }

  async resolvePrincipal(token: AuthPrincipal): Promise<AuthPrincipal> {
    const user = await this.prisma.user.findUnique({
      where: { id: token.sub },
      include: { facultyDomain: { select: { code: true, name: true } }, student: { select: { registerNumber: true } } },
    });
    if (!user || !user.isActive || user.email !== token.email) {
      throw new UnauthorizedException('Account is inactive or no longer exists');
    }
    if (user.authVersion !== token.ver) {
      throw new UnauthorizedException('This session has been revoked');
    }
    return {
      ...token,
      role: user.role,
      studentId: user.studentId,
      facultyDomainId: user.facultyDomainId,
      facultyDomainCode: user.facultyDomain?.code ?? null,
      facultyDomainName: user.facultyDomain?.name ?? null,
      loginIdentifier: user.role === 'STUDENT' ? user.student?.registerNumber ?? user.email : user.email,
    };
  }

  hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const derived = scryptSync(password, salt, 64).toString('hex');
    return `scrypt$${salt}$${derived}`;
  }

  validateIntegrationKey(value: string | undefined) {
    const expected = process.env.INTEGRATION_API_KEY;
    return Boolean(value && expected && this.safeEqual(value, expected));
  }

  private verifyPassword(password: string, stored: string) {
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') {
      const demo = (process.env.DEMO_MODE ?? 'false').toLowerCase() === 'true';
      return demo && this.safeEqual(password, stored);
    }

    const salt = parts[1];
    const expected = parts[2];
    const derived = scryptSync(password, salt, 64).toString('hex');
    return this.safeEqual(derived, expected);
  }

  private signature(data: string) {
    return createHmac('sha256', this.secret())
      .update(data)
      .digest('base64url');
  }

  private secret() {
    const value = process.env.AUTH_TOKEN_SECRET;
    if (!value || value.length < 32) {
      throw new ServiceUnavailableException(
        'AUTH_TOKEN_SECRET must contain at least 32 characters',
      );
    }
    return value;
  }

  private tokenTtlSeconds() {
    const configured = Number(process.env.AUTH_TOKEN_TTL_SECONDS ?? 28800);
    return Number.isFinite(configured) && configured >= 300
      ? Math.floor(configured)
      : 28800;
  }

  private base64Url(value: string) {
    return Buffer.from(value, 'utf8').toString('base64url');
  }

  private safeEqual(left: string, right: string) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
