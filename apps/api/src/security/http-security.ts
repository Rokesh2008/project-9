import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export function validateProductionConfiguration(env = process.env) {
  if (env.NODE_ENV !== 'production') return;
  if (env.AUTH_REQUIRED !== 'true' || env.DEMO_MODE !== 'false') throw new Error('Production requires authentication and demo mode disabled');
  if (!env.AUTH_TOKEN_SECRET || env.AUTH_TOKEN_SECRET.length < 32) throw new Error('Production signing secret is missing or too short');
  const origins = env.WEB_ORIGIN?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
  if (!origins.length || origins.some(origin => { try { const u = new URL(origin); return u.protocol !== 'https:' || u.origin !== origin; } catch { return true; } })) throw new Error('Production requires explicit HTTPS frontend origins');
  if (env.PERSISTENCE_DRIVER !== 'postgres' || !env.DATABASE_URL) throw new Error('Production requires PostgreSQL persistence');
}

// Per-instance protection. Do not treat this as a distributed WAF or DDoS control.
export function securityMiddleware(env = process.env, distributed = false) {
  const buckets = new Map<string, { count: number; expires: number }>();
  const windowMs = 60_000;
  return (req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID(), started = Date.now();
    res.setHeader('X-Request-ID', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cache-Control', 'no-store');
    if (env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (env.HTTP_LOGGING === 'true') res.on('finish', () => {
      if (req.path.startsWith('/api/health')) return;
      // No body, headers, query, IP, account ID, student ID or upstream content.
      console.info(JSON.stringify({ event: 'http.request', requestId, method: req.method, route: req.route?.path ?? 'unmatched', status: res.statusCode, durationMs: Date.now() - started }));
    });
    if (req.path.startsWith('/api/health') || req.method === 'OPTIONS') return next();
    if (env.MAINTENANCE_WRITES === 'true' && !['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Retry-After', '60'); res.status(503).json({ message: 'Brief maintenance in progress. Please retry shortly.' }); return;
    }
    if (distributed) return next();
    const login = req.path === '/api/auth/login';
    const key = `${req.ip ?? req.socket.remoteAddress}:${login ? 'login' : 'api'}`;
    if (buckets.size >= 10_000) {
      for (const [id, value] of buckets) if (value.expires <= started) buckets.delete(id);
      if (buckets.size >= 10_000 && !buckets.has(key)) { res.setHeader('Retry-After', '60'); res.status(429).json({ message: 'Request capacity exceeded', requestId }); return; }
    }
    let bucket = buckets.get(key);
    if (!bucket || bucket.expires <= started) { bucket = { count: 0, expires: started + windowMs }; buckets.set(key, bucket); }
    // Campus users may share one NAT address: allow the 100-user intake burst.
    const limit = login ? 120 : 600;
    if (++bucket.count > limit) { res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.expires - started) / 1000)))); res.status(429).json({ message: 'Too many requests. Please retry later.', requestId }); return; }
    next();
  };
}

export function loginAccountLimiter() {
  const buckets=new Map<string,{count:number;expires:number}>();
  return (req:Request,res:Response,next:NextFunction)=>{
    if(req.path!=='/api/auth/login'||req.method!=='POST')return next();
    const value=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
    if(!value||value.length>254)return next();
    const key=createHash('sha256').update(value).digest('hex'),now=Date.now();
    if(buckets.size>=10_000){for(const [id,b]of buckets)if(b.expires<=now)buckets.delete(id);if(buckets.size>=10_000&&!buckets.has(key)){res.status(429).json({message:'Login capacity exceeded'});return;}}
    let bucket=buckets.get(key);if(!bucket||bucket.expires<=now){bucket={count:0,expires:now+60_000};buckets.set(key,bucket);}
    if(++bucket.count>12){res.setHeader('Retry-After',String(Math.max(1,Math.ceil((bucket.expires-now)/1000))));res.status(429).json({message:'Too many login attempts for this account. Please retry later.'});return;}
    next();
  };
}

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const parserStatus = (exception as { status?: number })?.status;
    const status = exception instanceof HttpException ? exception.getStatus() : parserStatus === 413 || parserStatus === 400 ? parserStatus : 500;
    const requestId = res.getHeader('X-Request-ID');
    if (status >= 500) {
      console.error(JSON.stringify({ event: 'http.error', requestId, status, type: exception instanceof Error ? exception.name : 'UnknownError' }));
      res.status(status).json({ statusCode: status, message: 'Service temporarily unavailable. Please retry.', requestId });
      return;
    }
    const body = exception instanceof HttpException ? exception.getResponse() : { message: status === 413 ? 'Request body is too large' : 'Invalid request body' };
    res.status(status).json({ ...(typeof body === 'string' ? { message: body } : body), requestId });
  }
}
