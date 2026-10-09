import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      path?: string;
      url?: string;
      method?: string;
      headers: Record<string, string | string[] | undefined>;
      user?: unknown;
    }>();

    const path = request.path ?? request.url ?? '';
    if (this.isPublicPath(path)) return true;

    const required =
      (process.env.AUTH_REQUIRED ?? 'true').toLowerCase() === 'true';

    if (path.startsWith('/api/integrations/')) {
      const configured = process.env.INTEGRATION_API_KEY;
      const supplied = this.header(request.headers, 'x-integration-api-key');
      if (this.auth.validateIntegrationKey(supplied)) return true;
      if (required && !this.header(request.headers, 'authorization')) {
        if (!configured) {
          throw new ServiceUnavailableException(
            'INTEGRATION_API_KEY is not configured',
          );
        }
        throw new UnauthorizedException('Valid integration API key required');
      }
    }

    const authorization = this.header(request.headers, 'authorization');
    if (!authorization) {
      if (required) throw new UnauthorizedException('Bearer token required');
      return true;
    }

    const token = this.auth.extractBearer(authorization);
    if (!token) {
      if (required) throw new UnauthorizedException('Bearer token required');
      return true;
    }

    const principal = await this.auth.resolvePrincipal(token);
    request.user = principal;
    request.headers['x-role'] = principal.role;
    request.headers['x-actor-id'] = principal.sub;

    if (path.startsWith('/api/integrations/') && !['ADMIN', 'COORDINATOR'].includes(principal.role)) {
      throw new ForbiddenException('Administrator or coordinator role required for integrations');
    }
    this.assertAccess(path, request.method ?? 'GET', principal.role);
    return true;
  }

  private isPublicPath(path: string) {
    return (
      path === '/api/health' ||
      path === '/api/health/ready' ||
      path.startsWith('/api/docs') ||
      path === '/api/auth/login' ||
      path === '/api/auth/bootstrap'
    );
  }

  private assertAccess(path: string, method: string, role: string) {
    const action = method.toUpperCase();
    if (path.startsWith('/api/accounts')) {
      if (role !== 'ADMIN') throw new ForbiddenException('Administrator role required');
      return;
    }
    if (role === 'STUDENT') {
      if (action === 'GET' && (path === '/api/auth/me' || path === '/api/profiles/me')) return;
      throw new ForbiddenException('Students may view only their own selection profile');
    }
    if (role === 'PEP_STAFF') {
      // This service re-checks the authenticated faculty domain on every mutation.
      if (path === '/api/selection-rules' || path.startsWith('/api/selection-rules/')) return;
      const facultyRead = action === 'GET' && (
        path === '/api/auth/me' ||
        path === '/api/profiles' ||
        path.startsWith('/api/profiles/') ||
        path === '/api/allocations' ||
        path.startsWith('/api/allocations/') ||
        path === '/api/agent/selection/recommendations'
      );
      const allocationDecision = action === 'POST' &&
        /^\/api\/allocations\/[^/]+\/(approve|reject)$/.test(path);
      const advisoryDecision = action === 'POST' &&
        /^\/api\/agent\/selection\/recommendations\/[^/]+\/decision$/.test(path);
      if (facultyRead || allocationDecision || advisoryDecision) return;
      throw new ForbiddenException('Faculty access is limited to assigned-domain review');
    }
    if (action === 'GET') return;

    const protectedPrefixes = [
      '/api/cycles',
      '/api/weights',
      '/api/eligibility',
      '/api/scoring',
      '/api/ranking',
      '/api/classification',
      '/api/freeze',
      '/api/snapshot',
      '/api/agent',
      '/api/demo',
      '/api/selection-pipeline',
    ];

    if (path.startsWith('/api/allocations')) {
      if (!['ADMIN', 'COORDINATOR'].includes(role)) {
        throw new ForbiddenException('Allocation staff role required');
      }
      return;
    }

    if (protectedPrefixes.some((prefix) => path.startsWith(prefix))) {
      if (!['ADMIN', 'COORDINATOR'].includes(role)) {
        throw new ForbiddenException('Administrator or coordinator role required');
      }
    }
  }

  private header(
    headers: Record<string, string | string[] | undefined>,
    key: string,
  ) {
    const value = headers[key];
    return Array.isArray(value) ? value[0] : value;
  }
}
