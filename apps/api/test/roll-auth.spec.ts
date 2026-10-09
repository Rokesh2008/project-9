import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/common/prisma.service';
describe('Explicit student roll login',()=>{
 let auth:AuthService;let account:any;let db:any;
 beforeEach(()=>{process.env.AUTH_TOKEN_SECRET='roll-login-test-secret-at-least-32-characters';db={user:{findUnique:jest.fn()},student:{findUnique:jest.fn()}};auth=new AuthService(db as PrismaService);account={id:'u1',email:'internal@students.local',role:'STUDENT',name:'Test',password:auth.hashPassword('temp1'),loginIdentifier:'24AD107',isActive:true,authVersion:3,studentId:'s1',student:{isActive:true}};});
 afterEach(()=>{delete process.env.AUTH_TOKEN_SECRET;});
 it('accepts normalized roll and exposes the roll identifier',async()=>{db.user.findUnique.mockResolvedValue(account);const r=await auth.login(' 24ad107 ','temp1');expect(r.user.loginIdentifier).toBe('24AD107');expect(auth.verifyToken(r.accessToken).ver).toBe(3);expect(db.student.findUnique).not.toHaveBeenCalled();});
 it('rejects old register login after migration',async()=>{db.user.findUnique.mockResolvedValue(null);db.student.findUnique.mockResolvedValue({isActive:true,user:account});await expect(auth.login('123456789012','temp1')).rejects.toThrow('Invalid login');});
 it('rejects internal email login for migrated students',async()=>{db.user.findUnique.mockResolvedValue(account);await expect(auth.login(account.email,'temp1')).rejects.toThrow('Use your roll number');});
 it('rejects an inactive student record',async()=>{db.user.findUnique.mockResolvedValue({...account,student:{isActive:false}});await expect(auth.login('24AD107','temp1')).rejects.toThrow('Invalid login');});
 it('keeps administrator email login',async()=>{db.user.findUnique.mockResolvedValue({...account,role:'ADMIN',loginIdentifier:null});expect((await auth.login(account.email,'temp1')).user.role).toBe('ADMIN');});
});
