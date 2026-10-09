import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { SelectionRulesService } from '../src/selection-rules/selection-rules.service';
import { ClassificationService } from '../src/member1/classification/classification.service';

describe('Scoped custom selection rules',()=>{
 let app:INestApplication,db:PrismaService,rulesService:SelectionRulesService,classifications:ClassificationService;
 let cycle:string,domain:string,otherDomain:string,student:string,department:string,programId:string;
 let admin:string,faculty:string,otherFaculty:string,studentToken:string;
 const prior={...process.env};
 const endpoint='/api/selection-rules';
 const base={name:'Synthetic rule policy',program:'BOTH',logic:'AND',rules:[{id:'cgpa',field:'cgpa',operator:'GTE',value:8}]};
 const call=(token:string,path:string,body:object)=>request(app.getHttpServer()).post(`${endpoint}${path}`).set('Authorization',`Bearer ${token}`).send(body);
 const input=(scope:string|null=domain)=>({...base,selectionCycleId:cycle,domainId:scope});
 beforeAll(async()=>{
  Object.assign(process.env,{AUTH_REQUIRED:'true',AUTH_TOKEN_SECRET:'test-custom-rules-secret-at-least-thirty-two-characters',PERSISTENCE_DRIVER:'file',DEMO_MODE:'false',STATE_FILE:`/tmp/project9-rules-test-${process.pid}.json`});
  const module=await Test.createTestingModule({imports:[AppModule]}).compile();
  app=module.createNestApplication();app.setGlobalPrefix('api');app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));await app.init();
  db=module.get(PrismaService);rulesService=module.get(SelectionRulesService);classifications=module.get(ClassificationService);
  const auth=module.get(AuthService);
  department=(await db.department.create({data:{code:'CUSTOM-RULES-TEST',name:'Synthetic Rules Test'}})).id;
  const batch=await db.batch.create({data:{departmentId:department,batchIdentifier:'CUSTOM-RULES-TEST',academicYear:'2026'}});
  student=(await db.student.create({data:{studentId:'CUSTOM-RULES-TEST',registerNumber:'CUSTOM-RULES-TEST',name:'Synthetic Rules Student',batchId:batch.id,cgpa:7.5,attendancePercent:90}})).id;
  cycle=(await db.selectionCycle.create({data:{code:'CUSTOM-RULES-TEST',name:'Synthetic Rules Cycle',academicPeriod:'2026',startDate:new Date(),endDate:new Date('2027-01-01')}})).id;
  programId=(await db.program.create({data:{code:'CUSTOM-RULES-TEST',name:'Synthetic Rules Program'}})).id;
  domain=(await db.domain.create({data:{programId,code:'CUSTOM-RULES-A',name:'Synthetic Rules A'}})).id;
  otherDomain=(await db.domain.create({data:{programId,code:'CUSTOM-RULES-B',name:'Synthetic Rules B'}})).id;
  async function token(suffix:string,role:'ADMIN'|'PEP_STAFF'|'STUDENT',facultyDomainId?:string){
   const u=await db.user.create({data:{email:`custom-rules-${suffix}@example.test`,name:suffix,password:auth.hashPassword('test-only'),role,facultyDomainId,studentId:role==='STUDENT'?student:undefined}});
   return (await auth.login(u.email,'test-only')).accessToken;
  }
  admin=await token('admin','ADMIN');faculty=await token('faculty-a','PEP_STAFF',domain);otherFaculty=await token('faculty-b','PEP_STAFF',otherDomain);studentToken=await token('student','STUDENT');
 });
 beforeEach(async()=>{
  await db.selectionCycle.update({where:{id:cycle},data:{status:'ACTIVE'}});
  await db.selectionRulePolicy.deleteMany({where:{selectionCycleId:cycle}});
  await db.hopePepClassification.deleteMany({where:{selectionCycleId:cycle}});
  await db.readinessAssessment.deleteMany({where:{studentId:student}});
 });
 afterAll(async()=>{
  await db.user.deleteMany({where:{email:{startsWith:'custom-rules-'}}});
  await db.student.delete({where:{id:student}});
  await db.selectionCycle.delete({where:{id:cycle}});
  await db.batch.deleteMany({where:{departmentId:department}});await db.department.delete({where:{id:department}});
  await db.domain.deleteMany({where:{programId}});await db.program.delete({where:{id:programId}});
  await app.close();for(const key of ['AUTH_REQUIRED','AUTH_TOKEN_SECRET','PERSISTENCE_DRIVER','DEMO_MODE','STATE_FILE']){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}
 });
 it('requires authentication and rejects students',async()=>{
  await request(app.getHttpServer()).get(`${endpoint}/options`).expect(401);
  await call(studentToken,'',input()).expect(403);
  await request(app.getHttpServer()).get(`${endpoint}/options`).set('Authorization',`Bearer ${studentToken}`).expect(403);
 });
 it('allows faculty own-domain drafts but rejects college-wide and foreign-domain drafts and spoofed scope',async()=>{
  await call(faculty,'',input()).expect(201);
  await call(faculty,'',input(null)).expect(403);
  await call(faculty,'',input(otherDomain)).expect(403);
  await call(faculty,'',{...input(),facultyDomainId:otherDomain}).expect(400);
 });
 it('allows admin global/domain drafts and marks other-domain versions read-only for faculty',async()=>{
  await call(admin,'',input(null)).expect(201);await call(admin,'',input(otherDomain)).expect(201);
  const listing=await request(app.getHttpServer()).get(`${endpoint}/cycles/${cycle}`).set('Authorization',`Bearer ${faculty}`).expect(200);
  expect(listing.body.policies.every((p:any)=>!p.canEdit)).toBe(true);
 });
 it('does not recalculate, allocate or classify when saving or activating a draft',async()=>{
  const draft=await call(faculty,'',input()).expect(201);expect(draft.body.isActive).toBe(false);
  await call(faculty,`/${draft.body.id}/activate`,{}).expect(201);
  expect(await db.hopePepClassification.count({where:{selectionCycleId:cycle}})).toBe(0);
  expect(await db.allocation.count({where:{selectionCycleId:cycle}})).toBe(0);
  expect(await db.scoreAuditLog.count({where:{selectionCycleId:cycle,entityId:draft.body.id}})).toBe(2);
 });
 it('cannot activate or deactivate another faculty domain or a global version',async()=>{
  for(const scope of [otherDomain,null]){const p=await call(admin,'',input(scope)).expect(201);await call(faculty,`/${p.body.id}/activate`,{}).expect(403);await call(faculty,`/${p.body.id}/deactivate`,{}).expect(403);}
 });
 it('atomically replaces only the matching scope/program active version',async()=>{
  const a=await call(admin,'',input()).expect(201),b=await call(admin,'',input()).expect(201),c=await call(admin,'',{...input(),program:'HOPE'}).expect(201);
  await call(admin,`/${a.body.id}/activate`,{}).expect(201);await call(admin,`/${c.body.id}/activate`,{}).expect(201);await call(admin,`/${b.body.id}/activate`,{}).expect(201);
  expect((await db.selectionRulePolicy.findUniqueOrThrow({where:{id:a.body.id}})).isActive).toBe(false);
  expect(await db.selectionRulePolicy.count({where:{selectionCycleId:cycle,isActive:true}})).toBe(2);
 });
 it.each([
  {field:'unknownField',operator:'GTE',value:1}, {field:'cgpa',operator:'GTE',value:11},
  {field:'readinessScore',operator:'GTE',value:251}, {field:'cgpa',operator:'GTE',value:'8'},
  {field:'certificateCount',operator:'GTE',value:1.5}, {field:'cgpa',operator:'MIN_COUNT',value:1},
 ])('validates field/comparison/threshold: %j',async(rule)=>{await call(admin,'',{...input(),rules:[{id:'bad',...rule}]}).expect(400);});
 it('previews without writing official results and rejects foreign-domain preview',async()=>{
  const p=await call(faculty,'/preview',{...input(),registerNumber:'CUSTOM-RULES-TEST'}).expect(201);
  expect(p.body.proposed.isEligible).toBe(false);expect(p.body.proposed.results[0].actual).toBe(7.5);expect(p.body.previewOnly).toBe(true);
  expect(await db.selectionRulePolicy.count({where:{selectionCycleId:cycle}})).toBe(0);
  await call(otherFaculty,'/preview',{...input(),registerNumber:'CUSTOM-RULES-TEST'}).expect(403);
 });
 it('fails missing/unverified readiness, accepts verified zero, and supports OR',async()=>{
  const payload={...input(),rules:[{id:'readiness',field:'readinessScore',operator:'GTE',value:0}],registerNumber:'CUSTOM-RULES-TEST'};
  expect((await call(faculty,'/preview',payload).expect(201)).body.proposed.isEligible).toBe(false);
  const row=await db.readinessAssessment.create({data:{studentId:student,sourceResultId:'test',sourceBatchId:'test',readinessScore:0,verificationStatus:'PENDING',parameterScores:[],assessedAt:new Date()}});
  expect((await call(faculty,'/preview',payload).expect(201)).body.proposed.isEligible).toBe(false);
  await db.readinessAssessment.update({where:{id:row.id},data:{verificationStatus:'VERIFIED'}});
  expect((await call(faculty,'/preview',payload).expect(201)).body.proposed.isEligible).toBe(true);
  expect((await call(faculty,'/preview',{...payload,logic:'OR',rules:[...payload.rules,...base.rules]}).expect(201)).body.proposed.isEligible).toBe(true);
 });
 it('domain criteria block that domain but do not change college-wide programme eligibility',async()=>{
  const p=await call(faculty,'',input()).expect(201);await call(faculty,`/${p.body.id}/activate`,{}).expect(201);
  await db.hopePepClassification.create({data:{studentId:student,selectionCycleId:cycle,program:'PEP',rank:1,status:'CLASSIFIED'}});
  expect((await rulesService.evaluate(student,cycle,null,'PEP')).isEligible).toBe(true);
  await expect(rulesService.assertAllocation(student,cycle,domain)).rejects.toThrow('Student does not meet');
  await expect(rulesService.assertAllocation(student,cycle,otherDomain)).resolves.toBeUndefined();
 });
 it('refuses placement without programme classification when custom rules apply',async()=>{
  const p=await call(faculty,'',input()).expect(201);await call(faculty,`/${p.body.id}/activate`,{}).expect(201);
  await expect(rulesService.assertAllocation(student,cycle,domain)).rejects.toThrow('Run official selection');
 });
 it('global HOPE rules gate HOPE only while PEP remains eligible',async()=>{
  const p=await call(admin,'',{...input(null),program:'HOPE'}).expect(201);await call(admin,`/${p.body.id}/activate`,{}).expect(201);
  expect((await rulesService.evaluate(student,cycle,null,'HOPE')).isEligible).toBe(false);
  expect((await rulesService.evaluate(student,cycle,null,'PEP')).isEligible).toBe(true);
 });
 it('rejects every frozen-cycle mutation even for admin',async()=>{
  const p=await call(admin,'',input()).expect(201);await db.selectionCycle.update({where:{id:cycle},data:{status:'FROZEN'}});
  await call(admin,'',input()).expect(400);await call(admin,`/${p.body.id}/activate`,{}).expect(400);await call(admin,`/${p.body.id}/deactivate`,{}).expect(400);
 });
 it('uses programme-specific frozen flags instead of live rules',async()=>{
  const spy=jest.spyOn(db.rankingSnapshotEntry,'findMany').mockResolvedValue([{studentId:student,rank:1,isEligible:true,hopeEligible:false,pepEligible:true,customEligibility:{hope:{isEligible:false},pep:{isEligible:true}}}] as any);
  const inputs=await classifications.loadFrozenClassificationInputs('synthetic-snapshot');
  expect(inputs[0]).toMatchObject({hopeEligible:false,pepEligible:true});spy.mockRestore();
 });
 it('persists global-rule failures in classification and shows the student reasons and next steps',async()=>{
  const baseline=await db.eligibilityRuleVersion.create({data:{selectionCycleId:cycle,version:1,createdBy:'test',isActive:true,rules:{logic:'AND',rules:[{id:'baseline',field:'cgpa',operator:'GTE',value:7}]}}});
  const weight=await db.weightVersion.create({data:{selectionCycleId:cycle,version:1,createdBy:'test'}});
  await db.cycleConfig.create({data:{selectionCycleId:cycle,hopeCount:1,pepCount:1,activeWeightVersionId:weight.id,eligibilityRuleVersionId:baseline.id}});
  await db.studentRanking.create({data:{selectionCycleId:cycle,studentId:student,weightVersionId:weight.id,totalScore:75,rank:1}});
  await db.eligibilityResult.create({data:{selectionCycleId:cycle,studentId:student,ruleVersionId:baseline.id,isEligible:true}});
  await db.studentCycleStatus.create({data:{selectionCycleId:cycle,studentId:student}});
  const p=await call(admin,'',input(null)).expect(201);await call(admin,`/${p.body.id}/activate`,{}).expect(201);
  await classifications.calculate(cycle,'synthetic-admin');
  const result=await db.hopePepClassification.findUniqueOrThrow({where:{studentId_selectionCycleId:{studentId:student,selectionCycleId:cycle}}});
  expect(result.program).toBe('NOT_ELIGIBLE');expect((result.customEligibility as any).hope.results[0].policyId).toBe(p.body.id);
  const profile=await request(app.getHttpServer()).get('/api/profiles/me').set('Authorization',`Bearer ${studentToken}`).expect(200);
  expect(profile.body.outcome).toBe('NOT_ELIGIBLE');expect(profile.body.reason).toContain(base.name);expect(profile.body.nextSteps.join(' ')).toContain('CGPA');
  await call(admin,`/${p.body.id}/deactivate`,{}).expect(201);
  const unchanged=await request(app.getHttpServer()).get('/api/profiles/me').set('Authorization',`Bearer ${studentToken}`).expect(200);
  expect(unchanged.body.outcome).toBe('NOT_ELIGIBLE');expect(unchanged.body.reason).toBe(profile.body.reason);
 });
});
