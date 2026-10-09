import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { SelectionPipelineService } from '../src/selection-pipeline.service';
import { createSelectionDemo } from '../src/selection-demo.fixture';

describe('Isolated runnable selection demo',()=>{
  let db:PrismaService, module:Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  beforeAll(async()=>{process.env.PERSISTENCE_DRIVER='postgres';process.env.AUTH_REQUIRED='false';process.env.DEMO_MODE='false';process.env.STATE_FILE=`/tmp/project9-isolated-demo-${process.pid}.json`;module=await Test.createTestingModule({imports:[AppModule]}).compile();db=module.get(PrismaService);await db.$connect();});
  afterAll(async()=>{await module.close();});
  it('runs baseline, strict and relaxed rules without replacing the real cycle',async()=>{
    await db.$executeRawUnsafe('TRUNCATE TABLE "Department", "SelectionCycle", "Program" RESTART IDENTITY CASCADE');
    const real=await db.selectionCycle.create({data:{code:'REAL-CYCLE-UNTOUCHED',name:'Real cycle',academicPeriod:'2026',startDate:new Date(),endDate:new Date(),status:'ACTIVE'}});
    const before=await db.selectionCycle.findUnique({where:{id:real.id}});
    const cycle=await createSelectionDemo(db);
    const demoBatch=await db.batch.findUniqueOrThrow({where:{batchIdentifier:cycle.code}});
    const outside=await db.student.create({data:{studentId:'UNRELATED-REAL-FIXTURE',name:'Outside the demo',batchId:demoBatch.id}});
    expect((await createSelectionDemo(db)).id).toBe(cycle.id);
    expect(cycle.status).toBe('DRAFT');
    const pipeline=module.get(SelectionPipelineService);
    await expect(pipeline.runDemo(real.id,'test')).rejects.toThrow('isolated synthetic');
    const baseline=await pipeline.runDemo(cycle.id,'test');
    expect(baseline).toMatchObject({selected:4,waitlisted:1,ineligible:1});
    const policy=await db.selectionRulePolicy.create({data:{selectionCycleId:cycle.id,scopeKey:'GLOBAL',program:'BOTH',name:'Demo strict coding',isActive:true,createdBy:'test',rules:{logic:'AND',rules:[{id:'coding-demo',field:'codingScore',operator:'GTE',value:80}]}}});
    expect(await pipeline.runDemo(cycle.id,'test')).toMatchObject({selected:2,waitlisted:0,ineligible:4});
    const status=await pipeline.demoStatus(cycle.id);
    expect(status.students[2].program).toBe('NOT_ELIGIBLE');
    expect(status.students[2].customEligibility).toBeTruthy();
    await db.selectionRulePolicy.update({where:{id:policy.id},data:{rules:{logic:'AND',rules:[{id:'coding-demo',field:'codingScore',operator:'GTE',value:60}]}}});
    expect(await pipeline.runDemo(cycle.id,'test')).toMatchObject({selected:4,waitlisted:0,ineligible:2});
    expect(await db.selectionCycle.findUnique({where:{id:real.id}})).toEqual(before);
    expect(await db.studentCycleStatus.count({where:{selectionCycleId:real.id}})).toBe(0);
    expect(await db.eligibilityResult.count({where:{studentId:outside.id}})).toBe(0);
  });
  it('refuses to run if demo enrollment contains a real student',async()=>{
    const cycle=await createSelectionDemo(db);
    const member=await db.studentCycleStatus.findFirstOrThrow({where:{selectionCycleId:cycle.id}});
    await db.student.update({where:{id:member.studentId},data:{studentId:'REAL-STUDENT'}});
    await expect(module.get(SelectionPipelineService).runDemo(cycle.id,'test')).rejects.toThrow('isolation check failed');
  });
});
