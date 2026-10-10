import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { SelectionPipelineService } from '../src/selection-pipeline.service';
import { ProfilesService } from '../src/profiles/profiles.service';
import { createSelectionDemo } from '../src/selection-demo.fixture';
import { READINESS_PARAMETERS } from '../src/readiness/readiness.catalog';
import { OfficialReadService } from '../src/official-read.service';

describe('Batched selection performance and parity',()=>{
  let db:PrismaService, pipeline:SelectionPipelineService, module:Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
  beforeAll(async()=>{
    process.env.PERSISTENCE_DRIVER='postgres';process.env.AUTH_REQUIRED='false';process.env.DEMO_MODE='false';process.env.STATE_FILE=`/tmp/project9-performance-${process.pid}.json`;
    module=await Test.createTestingModule({imports:[AppModule]}).compile();db=module.get(PrismaService);pipeline=module.get(SelectionPipelineService);await db.$connect();
  });
  afterAll(async()=>{await module.close();});
  beforeEach(async()=>{await db.$executeRawUnsafe('TRUNCATE TABLE "Department", "SelectionCycle", "Program" RESTART IDENTITY CASCADE');});
  const snapshot=async(id:string)=>({
    scores:await db.studentScore.findMany({where:{selectionCycleId:id},select:{studentId:true,parameterKey:true,rawScore:true,isMissing:true,normalizedScore:true,weightedScore:true,weight:true},orderBy:[{studentId:'asc'},{parameterKey:'asc'}]}),
    rankings:await db.studentRanking.findMany({where:{selectionCycleId:id},select:{studentId:true,totalScore:true,rank:true,percentile:true,tieBreakApplied:true},orderBy:{rank:'asc'}}),
    eligibility:await db.eligibilityResult.findMany({where:{selectionCycleId:id},select:{studentId:true,isEligible:true,failedRules:true},orderBy:{studentId:'asc'}}),
    classification:await db.hopePepClassification.findMany({where:{selectionCycleId:id},select:{studentId:true,program:true,rank:true,customEligibility:true,status:true},orderBy:{rank:'asc'}}),
    workflow:await db.studentCycleStatus.findMany({where:{selectionCycleId:id},select:{studentId:true,currentState:true},orderBy:{studentId:'asc'}}),
  });
  it('matches the existing engines and persisted explanations, including missing/unverified inputs and custom programs',async()=>{
    const cycle=await createSelectionDemo(db);
    const first=await db.student.findUniqueOrThrow({where:{studentId:'RULEDEMO-1'}});
    await db.readinessAssessment.create({data:{studentId:first.id,sourceResultId:'test',sourceBatchId:'test',readinessScore:180,verificationStatus:'PENDING',parameterScores:[],assessedAt:new Date()}});
    await db.assessmentResult.deleteMany({where:{studentId:first.id,assessmentType:'APTITUDE'}});
    await db.selectionRulePolicy.create({data:{selectionCycleId:cycle.id,scopeKey:'GLOBAL',program:'HOPE',name:'HOPE coding',isActive:true,createdBy:'test',rules:{logic:'AND',rules:[{id:'coding',field:'codingScore',operator:'GTE',value:80}]}}});
    const legacy=pipeline as unknown as {runLegacy(id:string,actor:string):Promise<unknown>};
    await legacy.runLegacy(cycle.id,'parity');
    const before=await snapshot(cycle.id);
    await pipeline.run(cycle.id,'parity');
    expect(await snapshot(cycle.id)).toEqual(before);
    await db.selectionCycle.update({where:{id:cycle.id},data:{status:'ACTIVE'}});
    const official=module.get(OfficialReadService);
    const legacySummary=official as unknown as {selectionSummaryLegacy:OfficialReadService['selectionSummary']};
    expect(await official.selectionSummary()).toEqual(await legacySummary.selectionSummaryLegacy());
    const profiles=module.get(ProfilesService);
    const principal={sub:'test',email:'test@example.com',role:'ADMIN' as const,iat:0,exp:9999999999};
    const reference=profiles as unknown as {listForStaffLegacy:ProfilesService['listForStaff']};
    for(const sort of ['', 'readiness_asc','readiness_desc']) expect(await profiles.listForStaff(principal,'',1,sort)).toEqual(await reference.listForStaffLegacy(principal,'',1,sort));
  });
  it('rolls back all selection writes on invalid input, and rejects frozen cycles',async()=>{
    const cycle=await createSelectionDemo(db);await pipeline.run(cycle.id,'test');
    const before=await snapshot(cycle.id);
    await db.assessmentResult.updateMany({where:{assessmentType:'CODING'},data:{score:101}});
    await expect(pipeline.run(cycle.id,'test')).rejects.toThrow('must be between');
    expect(await snapshot(cycle.id)).toEqual(before);
    await db.selectionCycle.update({where:{id:cycle.id},data:{status:'FROZEN'}});
    await expect(pipeline.run(cycle.id,'test')).rejects.toThrow('Frozen cycles');
  });
  it('preserves the empty-cycle response before eligibility rules are configured',async()=>{
    const cycle=await createSelectionDemo(db);
    await db.studentCycleStatus.deleteMany({where:{selectionCycleId:cycle.id}});
    await db.cycleConfig.update({where:{selectionCycleId:cycle.id},data:{eligibilityRuleVersionId:null}});
    await db.eligibilityRuleVersion.deleteMany({where:{selectionCycleId:cycle.id}});
    expect(await pipeline.run(cycle.id,'test')).toEqual({selectionCycleId:cycle.id,scored:0,eligibilityEvaluated:0,ranked:0,classified:0,results:[]});
  });
  it('runs 5,000 synthetic students without per-student database round trips',async()=>{
    const cycle=await createSelectionDemo(db);
    const batch=await db.batch.findUniqueOrThrow({where:{batchIdentifier:cycle.code}});
    const students=Array.from({length:4994},(_,i)=>({id:randomUUID(),studentId:`PERF-${String(i).padStart(5,'0')}`,name:`Synthetic performance ${i}`,batchId:batch.id,attendancePercent:90}));
    for(let i=0;i<students.length;i+=500) {
      const chunk=students.slice(i,i+500);
      await db.student.createMany({data:chunk});
      await db.studentCycleStatus.createMany({data:chunk.map(s=>({studentId:s.id,selectionCycleId:cycle.id}))});
      await db.assessmentResult.createMany({data:chunk.map((s,j)=>({studentId:s.id,sourceIdentifier:'performance',assessmentType:'CODING' as const,score:50+(j%51),maxScore:100}))});
    }
    const started=performance.now();
    const result=await pipeline.run(cycle.id,'performance-test');
    const elapsedMs=Math.round(performance.now()-started);
    process.stdout.write(`\nPERFORMANCE: 5000 synthetic students, ${elapsedMs}ms, selected=${result.selected}\n`);
    expect(result).toMatchObject({scored:5000,eligibilityEvaluated:5000,ranked:5000,classified:5000,selected:4,waitlisted:4995,ineligible:1});
    expect(await db.studentRanking.count({where:{selectionCycleId:cycle.id}})).toBe(5000);
    // Broad regression budget suitable for CI; this is not a production SLA.
    expect(elapsedMs).toBeLessThan(30000);
    const weights=await db.weightVersion.create({data:{selectionCycleId:cycle.id,version:2,createdBy:'performance-test',weights:{create:READINESS_PARAMETERS.map((p,i)=>({parameterKey:p.key,parameterLabel:p.label,weight:1/12,maxRawScore:p.maxScore,sortOrder:i}))}}});
    await db.cycleConfig.update({where:{selectionCycleId:cycle.id},data:{activeWeightVersionId:weights.id}});
    const members=await db.studentCycleStatus.findMany({where:{selectionCycleId:cycle.id}});
    for(let i=0;i<members.length;i+=500) await db.readinessAssessment.createMany({data:members.slice(i,i+500).map(s=>({studentId:s.studentId,sourceResultId:'performance-12',sourceBatchId:'performance-12',readinessScore:125,verificationStatus:'VERIFIED',parameterScores:READINESS_PARAMETERS.map(p=>({parameterKey:p.key,rawScore:p.maxScore/2,verificationStatus:'VERIFIED'})),assessedAt:new Date()}))});
    const readinessStarted=performance.now();
    expect(await pipeline.run(cycle.id,'performance-test')).toMatchObject({scored:5000,ranked:5000,classified:5000});
    const readinessElapsedMs=Math.round(performance.now()-readinessStarted);
    process.stdout.write(`\nPERFORMANCE: 5000 synthetic students × 12 verified parameters, ${readinessElapsedMs}ms\n`);
    expect(await db.studentScore.count({where:{selectionCycleId:cycle.id,weightVersionId:weights.id}})).toBe(60000);
    expect(readinessElapsedMs).toBeLessThan(30000);
  },60000);
});
