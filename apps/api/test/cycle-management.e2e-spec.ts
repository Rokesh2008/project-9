import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/common/prisma.service';

describe('Admin cycle management',()=>{
  let app:INestApplication,db:PrismaService,admin:string,faculty:string,studentToken:string,student:string,batch:string,department:string,source:string,program:string,domain:string;
  const prefix=`CYCMGMT-${process.pid}`,prior={...process.env};let activeBefore:string[]=[];
  const input=(code:string)=>({code:`${prefix}-${code}`,name:'New selection round',academicPeriod:'2026–2027',startDate:'2026-10-10',endDate:'2027-01-01',hopeCount:1,pepCount:1,cohort:'SELECTED',studentIds:[student],readinessMinimum:30});
  const call=(path:string,body:object,token=admin)=>request(app.getHttpServer()).post(`/api/cycle-management${path}`).set('Authorization',`Bearer ${token}`).send(body);
  beforeAll(async()=>{
    Object.assign(process.env,{AUTH_REQUIRED:'true',AUTH_TOKEN_SECRET:'cycle-management-test-only-signing-secret',PERSISTENCE_DRIVER:'file',DEMO_MODE:'false',STATE_FILE:`/tmp/${prefix}.json`,ENABLE_FREEZE_SCHEDULER:'false'});
    const module=await Test.createTestingModule({imports:[AppModule]}).compile();app=module.createNestApplication();app.setGlobalPrefix('api');app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));await app.init();db=module.get(PrismaService);
    activeBefore=(await db.selectionCycle.findMany({where:{status:'ACTIVE'},select:{id:true}})).map(c=>c.id);
    department=(await db.department.create({data:{code:prefix,name:'Test department'}})).id;
    batch=(await db.batch.create({data:{departmentId:department,batchIdentifier:prefix,academicYear:'2026'}})).id;
    student=(await db.student.create({data:{studentId:prefix,registerNumber:prefix,name:'Test student',batchId:batch}})).id;
    const auth=module.get(AuthService);
    async function login(suffix:string,role:'ADMIN'|'PEP_STAFF'|'STUDENT'){
      const email=`${prefix}-${suffix}@example.test`.toLowerCase();await db.user.create({data:{email,name:suffix,password:auth.hashPassword('test-only'),role,studentId:role==='STUDENT'?student:undefined}});return (await auth.login(email,'test-only')).accessToken;
    }
    admin=await login('admin','ADMIN');faculty=await login('faculty','PEP_STAFF');studentToken=await login('student','STUDENT');
    program=(await db.program.create({data:{code:prefix,name:'Test program'}})).id;domain=(await db.domain.create({data:{programId:program,code:prefix,name:'Test domain'}})).id;
  });
  afterAll(async()=>{
    await db.selectionCycle.deleteMany({where:{code:{startsWith:prefix}}});
    await db.selectionCycle.updateMany({where:{id:{in:activeBefore}},data:{status:'ACTIVE'}});
    await db.user.deleteMany({where:{email:{startsWith:prefix.toLowerCase()}}});if(student)await db.student.delete({where:{id:student}});
    if(batch)await db.batch.delete({where:{id:batch}});if(department)await db.department.delete({where:{id:department}});if(domain)await db.domain.delete({where:{id:domain}});if(program)await db.program.delete({where:{id:program}});
    await app.close();for(const key of ['AUTH_REQUIRED','AUTH_TOKEN_SECRET','PERSISTENCE_DRIVER','DEMO_MODE','STATE_FILE','ENABLE_FREEZE_SCHEDULER']){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}
  });
  it('denies unauthenticated, faculty and student cycle management',async()=>{
    await request(app.getHttpServer()).get('/api/cycle-management/options').expect(401);
    for(const token of [faculty,studentToken]){await request(app.getHttpServer()).get('/api/cycle-management/options').set('Authorization',`Bearer ${token}`).expect(403);await call('',input('DENIED'),token).expect(403);}
  });
  it('validates dates, seats, enrollment and unexpected fields without creating a cycle',async()=>{
    for(const patch of [{endDate:'2026-01-01'},{hopeCount:-1},{studentIds:[]},{studentIds:['missing']},{cohort:'BATCH',batchId:'missing'},{copyPreferences:true},{role:'ADMIN'}])await call('',{...input('INVALID'),...patch}).expect(400);
    expect(await db.selectionCycle.count({where:{code:`${prefix}-INVALID`}})).toBe(0);
  });
  it('creates a configured draft and enrollment without changing accounts or results',async()=>{
    const before=await db.user.findUniqueOrThrow({where:{studentId:student}});
    const result=await call('',input('SOURCE')).expect(201);source=result.body.id;
    expect(result.body.status).toBe('DRAFT');expect(result.body.enrolled).toBe(1);expect(result.body.selectionRecalculated).toBe(false);
    const config=await db.cycleConfig.findUniqueOrThrow({where:{selectionCycleId:source},include:{activeWeightVersion:{include:{weights:true}},activeEligibilityRule:true}});
    expect(config.activeWeightVersion!.weights[0]).toMatchObject({parameterKey:'readinessScore',weight:1,maxRawScore:250});expect(config.activeEligibilityRule!.isActive).toBe(true);
    expect(await db.hopePepClassification.count({where:{selectionCycleId:source}})).toBe(0);
    expect((await db.user.findUniqueOrThrow({where:{studentId:student}})).password).toBe(before.password);
    await call('',input('SOURCE')).expect(409);
  });
  it('copies configuration and explicitly requested preferences but no results or custom rules',async()=>{
    await db.studentPreference.create({data:{studentId:student,selectionCycleId:source,domainId:domain,preferenceRank:1}});
    await db.selectionRulePolicy.create({data:{selectionCycleId:source,scopeKey:'GLOBAL',name:'v1',rules:{logic:'AND',rules:[]},createdBy:'test',isActive:true}});
    const result=await call('',{...input('COPY'),cohort:'CYCLE',studentIds:undefined,templateCycleId:source,copyPreferences:true}).expect(201);
    expect(result.body.preferencesCopied).toBe(1);expect(result.body.enrolled).toBe(1);
    expect(await db.selectionRulePolicy.count({where:{selectionCycleId:result.body.id}})).toBe(0);
    const cfg=await db.cycleConfig.findUniqueOrThrow({where:{selectionCycleId:result.body.id}});const old=await db.cycleConfig.findUniqueOrThrow({where:{selectionCycleId:source}});expect(cfg.activeWeightVersionId).not.toBe(old.activeWeightVersionId);
  });
  it('enrolls a matching batch and exposes paginated student search',async()=>{
    const result=await call('',{...input('BATCH'),cohort:'BATCH',batchId:batch,studentIds:undefined}).expect(201);expect(result.body.enrolled).toBe(1);
    const list=await request(app.getHttpServer()).get(`/api/cycle-management/students?q=${prefix}`).set('Authorization',`Bearer ${admin}`).expect(200);expect(list.body.total).toBe(1);expect(list.body.students[0].id).toBe(student);
  });
  it('requires explicit archive consent and preserves the old cycle enrollment',async()=>{
    await db.selectionCycle.update({where:{id:source},data:{status:'ACTIVE'}});
    const draft=await call('',input('ACTIVATE')).expect(201);
    await call(`/${draft.body.id}/activate`,{}).expect(409);
    expect((await db.selectionCycle.findUniqueOrThrow({where:{id:source}})).status).toBe('ACTIVE');
    await call(`/${draft.body.id}/activate`,{archiveOtherActive:true}).expect(201);
    expect((await db.selectionCycle.findUniqueOrThrow({where:{id:source}})).status).toBe('ARCHIVED');expect(await db.studentCycleStatus.count({where:{selectionCycleId:source}})).toBe(1);
    await call(`/${draft.body.id}/activate`,{}).expect(201);
    expect(await db.scoreAuditLog.count({where:{selectionCycleId:draft.body.id,action:'CYCLE_ACTIVATED'}})).toBe(1);
    await call(`/${source}/activate`,{archiveOtherActive:true}).expect(400);
  });
});
