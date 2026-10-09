import { HttpException } from '@nestjs/common';
import { SafeExceptionFilter, loginAccountLimiter, securityMiddleware, validateProductionConfiguration } from '../src/security/http-security';
import { HealthController } from '../src/controllers';
describe('HTTP security controls',()=>{
 function response(){const headers:Record<string,unknown>={};const res:any={setHeader:jest.fn((k,v)=>headers[k]=v),getHeader:(k:string)=>headers[k],status:jest.fn().mockReturnThis(),json:jest.fn(),on:jest.fn()};return {res,headers};}
 it('adds security headers and server-generated request IDs',()=>{
  const {res,headers}=response(),next=jest.fn();securityMiddleware({NODE_ENV:'production'})({path:'/api/profiles/me',method:'GET',ip:'ip'} as any,res,next);
  expect(headers['X-Frame-Options']).toBe('DENY');expect(headers['Cache-Control']).toBe('no-store');expect(headers['X-Request-ID']).toMatch(/^[\da-f-]{36}$/);expect(next).toHaveBeenCalled();
 });
 it('throttles login attempts without logging credentials',()=>{
  const middleware=securityMiddleware({}),next=jest.fn(),{res}=response();for(let i=0;i<121;i++)middleware({path:'/api/auth/login',method:'POST',ip:'ip'} as any,res,next);
  expect(next).toHaveBeenCalledTimes(120);expect(res.status).toHaveBeenCalledWith(429);expect(res.setHeader).toHaveBeenCalledWith('Retry-After','60');
 });
 it('allows a campus login burst but limits repeated attempts per account',()=>{
  const middleware=loginAccountLimiter(),next=jest.fn(),{res}=response();
  for(let i=0;i<100;i++)middleware({path:'/api/auth/login',method:'POST',body:{email:`student${i}`}} as any,res,next);
  expect(next).toHaveBeenCalledTimes(100);
  for(let i=0;i<13;i++)middleware({path:'/api/auth/login',method:'POST',body:{email:'one-account'}} as any,res,next);
  expect(res.status).toHaveBeenCalledWith(429);
 });
 it('does not rate-limit health probes',()=>{
  const next=jest.fn(),{res}=response();securityMiddleware({})({path:'/api/health/ready',method:'GET'} as any,res,next);expect(next).toHaveBeenCalled();
 });
 it('does not leak internal errors or database credentials',()=>{
  const {res}=response();jest.spyOn(console,'error').mockImplementation(()=>{});
  new SafeExceptionFilter().catch(new Error('postgres://private-secret'),{switchToHttp:()=>({getResponse:()=>res})} as any);
  expect(res.status).toHaveBeenCalledWith(500);expect(JSON.stringify(res.json.mock.calls)).not.toContain('private-secret');jest.restoreAllMocks();
 });
 it('preserves validation errors and parser size errors',()=>{
  const {res}=response(),host={switchToHttp:()=>({getResponse:()=>res})} as any;
  const filter=new SafeExceptionFilter();filter.catch(new HttpException({message:['Invalid field']},400),host);expect(res.status).toHaveBeenCalledWith(400);
  filter.catch({status:413},host);expect(res.status).toHaveBeenCalledWith(413);
 });
 it('fails closed for insecure production settings',()=>{
  expect(()=>validateProductionConfiguration({NODE_ENV:'production'})).toThrow();
  const config={NODE_ENV:'production',AUTH_REQUIRED:'true',DEMO_MODE:'false',AUTH_TOKEN_SECRET:'a'.repeat(32),WEB_ORIGIN:'https://portal.example',PERSISTENCE_DRIVER:'postgres',DATABASE_URL:'configured'};
  expect(()=>validateProductionConfiguration(config)).not.toThrow();expect(()=>validateProductionConfiguration({...config,WEB_ORIGIN:'*'})).toThrow();
 });
 it('readiness reflects database availability',async()=>{
  const prisma={$queryRaw:jest.fn().mockResolvedValue([{one:1}])};const controller=new HealthController(prisma as any);await expect(controller.ready()).resolves.toEqual({status:'ready'});
  prisma.$queryRaw.mockRejectedValue(new Error('secret'));await expect(controller.ready()).rejects.toThrow('Database unavailable');
 });
});
