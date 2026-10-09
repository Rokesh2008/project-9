import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from './common/prisma.service';
import { computeStudentScores } from './member1/scoring/scoring.engine';
import { calculateRanking } from './member1/ranking/ranking.engine';
import { evaluateEligibility, RuleConfiguration, StudentContext, validateRuleConfiguration } from './member1/eligibility/eligibility.engine';
import { classifyStudents, validateClassificationConfig } from './member1/classification/classification.engine';
import { READINESS_PARAMETERS } from './readiness/readiness.catalog';

// Only these compile-time identifiers may be interpolated. All record values are
// JSON parameters, never SQL text. Preserve existing IDs and decision metadata.
const TABLES = {
  StudentScore: { columns: ['id','studentId','selectionCycleId','weightVersionId','parameterKey','rawScore','isMissing','normalizedScore','weight','weightedScore','calculatedAt'], keys: ['studentId','selectionCycleId','weightVersionId','parameterKey'], updates: ['rawScore','isMissing','normalizedScore','weight','weightedScore','calculatedAt'] },
  EligibilityResult: { columns: ['id','studentId','selectionCycleId','ruleVersionId','isEligible','failedRules','evaluatedAt'], keys: ['studentId','selectionCycleId'], updates: ['ruleVersionId','isEligible','failedRules','evaluatedAt'] },
  StudentRanking: { columns: ['id','studentId','selectionCycleId','weightVersionId','totalScore','rank','percentile','tieBreakApplied','calculatedAt'], keys: ['studentId','selectionCycleId'], updates: ['weightVersionId','totalScore','rank','percentile','tieBreakApplied','calculatedAt'] },
  HopePepClassification: { columns: ['id','studentId','selectionCycleId','program','customEligibility','rank','status','classifiedAt','updatedAt'], keys: ['studentId','selectionCycleId'], updates: ['program','customEligibility','rank','status','classifiedAt','updatedAt'] },
} as const;

async function upsert(tx: Prisma.TransactionClient, table: keyof typeof TABLES, rows: object[]) {
  if (!rows.length) return;
  const spec = TABLES[table];
  const quote = (s: string) => `"${s}"`;
  const columns = spec.columns.map(quote).join(',');
  // Bound memory/statement size for large cohorts while keeping round trips
  // proportional to batches, not students × parameters.
  for (let i = 0; i < rows.length; i += 2000) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO ${Prisma.raw(quote(table))} (${Prisma.raw(columns)})
      SELECT ${Prisma.raw(columns)} FROM jsonb_populate_recordset(NULL::${Prisma.raw(quote(table))}, ${JSON.stringify(rows.slice(i,i+2000))}::jsonb)
      ON CONFLICT (${Prisma.raw(spec.keys.map(quote).join(','))}) DO UPDATE SET
      ${Prisma.raw(spec.updates.map(c => `${quote(c)} = EXCLUDED.${quote(c)}`).join(','))}
    `);
  }
}

export async function runBulkSelection(prisma: PrismaService, selectionCycleId: string, actor: string, withCustomRules = true) {
  return prisma.$transaction(async tx => {
    // The same cycle lock used by custom-rule activation prevents a mixed rule
    // version within a run and serializes competing selection runs.
    await tx.$queryRaw`SELECT id FROM "SelectionCycle" WHERE id = ${selectionCycleId} FOR UPDATE`;
    const cycle = await tx.selectionCycle.findUnique({where:{id:selectionCycleId}});
    if (!cycle) throw new NotFoundException('Selection cycle not found');
    if (cycle.status === 'FROZEN') throw new BadRequestException('Frozen cycles cannot run the live selection pipeline');
    if (await tx.freezeSchedule.findFirst({where:{selectionCycleId,status:'EXECUTED'}})) throw new ConflictException('Cannot recalculate live selection after freeze has been executed');
    const config = await tx.cycleConfig.findUnique({where:{selectionCycleId},include:{activeWeightVersion:{include:{weights:{orderBy:{sortOrder:'asc'}}}}}});
    const weights = config?.activeWeightVersion;
    if (!config || !weights?.weights.length) throw new BadRequestException('An active weight version must be configured before running selection');
    if (weights.selectionCycleId!==selectionCycleId) throw new BadRequestException('Weight version does not belong to this selection cycle');
    const members = await tx.studentCycleStatus.findMany({where:{selectionCycleId},include:{student:{include:{assessmentResults:true,credentials:{where:{verificationStatus:'VERIFIED'},orderBy:{name:'asc'}}}}}});
    if (!members.length) return {selectionCycleId,scored:0,eligibilityEvaluated:0,ranked:0,classified:0,results:[]};
    const rule = config.eligibilityRuleVersionId
      ? await tx.eligibilityRuleVersion.findUnique({where:{id:config.eligibilityRuleVersionId}})
      : await tx.eligibilityRuleVersion.findFirst({where:{selectionCycleId,isActive:true}});
    if (!rule) throw new BadRequestException('No active eligibility rule version configured for this cycle');
    const ruleConfig = rule.rules as unknown as RuleConfiguration;
    const errors = [...validateRuleConfiguration(ruleConfig), ...validateClassificationConfig(config)];
    if (errors.length) throw new BadRequestException(errors);
    const ids = members.map(m=>m.studentId);
    const readiness = withCustomRules ? await tx.readinessAssessment.findMany({where:{studentId:{in:ids}},orderBy:[{assessedAt:'desc'},{createdAt:'desc'}],distinct:['studentId']}) : [];
    const preferences = await tx.studentPreference.findMany({where:{selectionCycleId,studentId:{in:ids}},orderBy:{preferenceRank:'asc'},include:{domain:true}});
    const policies = withCustomRules ? await tx.selectionRulePolicy.findMany({where:{selectionCycleId,scopeKey:'GLOBAL',isActive:true},orderBy:{createdAt:'asc'}}) : [];
    const prior = await tx.eligibilityResult.findMany({where:{selectionCycleId}});
    const eligible = new Map(prior.map(p=>[p.studentId,p.isEligible]));
    const readinessMap = new Map(readiness.map(r=>[r.studentId,r]));
    const preferenceMap = new Map<string,string[]>();
    for (const p of preferences) { const list = preferenceMap.get(p.studentId) ?? []; list.push(p.domain.code); preferenceMap.set(p.studentId,list); }
    const now = new Date();
    const scores: object[] = [], eligibilityRows: object[] = [];
    const audits: Prisma.ScoreAuditLogCreateManyInput[] = [];
    const contexts = new Map<string,StudentContext>();
    const missingInputs: Array<{studentId:string;parameters:string[]}> = [];
    const log = (action:string,entityId:string,metadata:object,entityType='Student') => audits.push({selectionCycleId,action,actor,entityType,entityId,metadata:metadata as Prisma.InputJsonValue});
    const rankingInputs = members.map(({student:s}) => {
      const prefs = preferenceMap.get(s.id) ?? [];
      const context: StudentContext = {studentId:s.studentId,registerNumber:s.registerNumber,name:s.name,email:s.email,isActive:s.isActive,batchId:s.batchId,cgpa:s.cgpa,attendancePercent:s.attendancePercent,dsaLevel:s.dsaLevel,verifiedCertificates:s.credentials.map(c=>c.name),certificateCount:s.credentials.length,preferences:prefs,preferenceCount:prefs.length};
      for (const a of s.assessmentResults) {
        const key = a.assessmentType.toLowerCase();
        if(context[`${key}Score`]===undefined || a.score > Number(context[`${key}Score`])) context[`${key}Score`]=a.score;
        context[`${key}MaxScore`]=a.maxScore;
        if(a.percentage!==null) context[`${key}Percentage`]=a.percentage;
      }
      const custom: StudentContext = {};
      if (withCustomRules) {
        const latest=readinessMap.get(s.id);
        custom.readinessScore=latest?.verificationStatus==='VERIFIED'?latest.readinessScore:null;
        const modules=(latest?.parameterScores??[]) as Array<{parameterKey:string;rawScore:number|null;verificationStatus:string}>;
        for(const f of READINESS_PARAMETERS) {const m=modules.find(m=>m.parameterKey===f.key);custom[f.key]=m?.verificationStatus==='VERIFIED'?m.rawScore:null;}
        Object.assign(context,custom);
      }
      contexts.set(s.id,context);
      const highest=(type:string)=>{const values=s.assessmentResults.filter(a=>a.assessmentType===type).map(a=>a.score);return values.length?Math.max(...values):null;};
      const readinessScore=s.assessmentResults.filter(a=>a.assessmentType==='OTHER'&&(a.metadata as {kind?:string}|null)?.kind==='READINESS_SCORE').sort((a,b)=>b.assessmentDate.getTime()-a.assessmentDate.getTime())[0]?.score??null;
      const aliases:Record<string,number|null>={coding:highest('CODING'),codingscore:highest('CODING'),aptitude:highest('APTITUDE'),aptitudescore:highest('APTITUDE'),communication:highest('COMMUNICATION'),communicationscore:highest('COMMUNICATION'),interview:highest('INTERVIEW'),interviewscore:highest('INTERVIEW'),cgpa:s.cgpa,attendance:s.attendancePercent,attendancepercent:s.attendancePercent,readiness:readinessScore,readinessscore:readinessScore,project2:readinessScore,project2score:readinessScore,certificatecount:s.credentials.length,certificates:s.credentials.length};
      const inputs=weights.weights.map(w=>({parameterKey:w.parameterKey,rawScore:(Object.hasOwn(custom,w.parameterKey)?custom[w.parameterKey]:aliases[w.parameterKey.trim().toLowerCase().replaceAll(/[^a-z0-9]/g,'')]??null) as number|null}));
      const missing=inputs.filter(p=>p.rawScore==null).map(p=>p.parameterKey);
      if(missing.length) missingInputs.push({studentId:s.id,parameters:missing});
      log('SCORE_CALCULATION_STARTED',s.id,{weightVersionId:weights.id,inputParameterCount:inputs.length,configuredParameterCount:weights.weights.length});
      for(const parameterKey of missing) log('SCORE_MISSING_PARAMETER',s.id,{parameterKey,weightVersionId:weights.id});
      const result=computeStudentScores(s.id,selectionCycleId,weights.id,inputs,weights.weights);
      for(const p of result.parameterScores) scores.push({id:randomUUID(),studentId:s.id,selectionCycleId,weightVersionId:weights.id,...p,calculatedAt:now});
      audits.push({selectionCycleId,action:'SCORE_CALCULATION_COMPLETED',actor,entityType:'Student',entityId:s.id,newValue:{weightVersionId:weights.id,weightVersion:weights.version,totalScore:result.totalScore,parameterCount:result.parameterScores.length,missingCount:missing.length}});
      if(s.isActive) {
        const evaluation=evaluateEligibility(context,ruleConfig);
        eligible.set(s.id,evaluation.isEligible);
        eligibilityRows.push({id:randomUUID(),studentId:s.id,selectionCycleId,ruleVersionId:rule.id,isEligible:evaluation.isEligible,failedRules:evaluation.failedRules.length?evaluation.failedRules.map(({ruleId,field,operator,expected,actual,message})=>({ruleId,field,operator,expected,actual,message})):null,evaluatedAt:now});
        for(const failure of evaluation.failedRules) log('ELIGIBILITY_RULE_FAILED',s.id,{ruleVersionId:rule.id,...failure});
      }
      // Ranking historically sums parameterKey-ordered stored weighted scores.
      const ordered=[...result.parameterScores].sort((a,b)=>a.parameterKey.localeCompare(b.parameterKey));
      return {studentId:s.id,totalScore:ordered.reduce((sum,p)=>sum+p.weightedScore,0),parameterScores:Object.fromEntries(ordered.map(p=>[p.parameterKey,p.weightedScore]))};
    });
    const ranking=calculateRanking(rankingInputs,weights.id);
    const evaluateCustom=(studentId:string,program:string)=>{
      // Classification uses global rules only. Domain rules remain enforced
      // by allocation, not by the college-wide selection stage.
      const context={...contexts.get(studentId)!,preferences:[],preferenceCount:0};
      const results=policies.filter(p=>p.program==='BOTH'||p.program===program).map(p=>({policyId:p.id,name:p.name,domainId:p.domainId,program:p.program,...evaluateEligibility(context,p.rules as unknown as RuleConfiguration)}));
      return {isEligible:results.every(r=>r.isEligible),results};
    };
    const classification=classifyStudents(ranking.rankedStudents.map(r=>{
      const baseline=eligible.get(r.studentId)??false;
      const hope=baseline&&withCustomRules?evaluateCustom(r.studentId,'HOPE'):null;
      const pep=baseline&&withCustomRules?evaluateCustom(r.studentId,'PEP'):null;
      return {studentId:r.studentId,rank:r.rank,hopeEligible:baseline&&(hope?.isEligible??true),pepEligible:baseline&&(pep?.isEligible??true),...(hope||pep?{customEligibility:{hope,pep}}:{})};
    }),config);
    await upsert(tx,'StudentScore',scores);
    await upsert(tx,'EligibilityResult',eligibilityRows);
    await upsert(tx,'StudentRanking',ranking.rankedStudents.map(r=>({id:randomUUID(),selectionCycleId,weightVersionId:weights.id,...r,calculatedAt:now})));
    await upsert(tx,'HopePepClassification',classification.classifiedStudents.map(c=>({id:randomUUID(),studentId:c.studentId,selectionCycleId,program:c.program,rank:c.rank,customEligibility:c.customEligibility??null,status:'CLASSIFIED',classifiedAt:now,updatedAt:now})));
    const memberMap=new Map(members.map(m=>[m.studentId,m]));
    const transitions=classification.classifiedStudents.flatMap(c=>{
      const member=memberMap.get(c.studentId)!;
      const toState=c.program==='HOPE'||c.program==='PEP'?'COMMUNICATION':c.program==='WAITLIST'?'HOPE_PEP':'ELIGIBILITY';
      return member.currentState===toState?[]:[{id:member.id,currentState:toState,studentId:c.studentId,fromState:member.currentState,program:c.program}];
    });
    if(transitions.length) {
      await tx.$executeRaw`UPDATE "StudentCycleStatus" s SET "currentState"=r."currentState", "updatedAt"=${now} FROM jsonb_populate_recordset(NULL::"StudentCycleStatus",${JSON.stringify(transitions)}::jsonb) r WHERE s.id=r.id`;
      for(let i=0;i<transitions.length;i+=2000) await tx.workflowAuditLog.createMany({data:transitions.slice(i,i+2000).map(t=>({studentCycleStatusId:t.id,studentId:t.studentId,selectionCycleId,fromState:t.fromState,toState:t.currentState as 'COMMUNICATION'|'HOPE_PEP'|'ELIGIBILITY',actor,role:'SYSTEM',reason:`Selection pipeline classified student as ${t.program}`,metadata:{source:'SELECTION_PIPELINE',program:t.program}}))});
    }
    for(const stage of ['ELIGIBILITY_EVALUATION','RANKING_CALCULATION','CLASSIFICATION_CALCULATION']) {
      log(`${stage}_STARTED`,selectionCycleId,{weightVersionId:weights.id,ruleVersionId:rule.id},'SelectionCycle');
      log(`${stage}_COMPLETED`,selectionCycleId,{totalStudents:members.length,weightVersionId:weights.id,ruleVersionId:rule.id,tiesResolved:ranking.tiesResolved,hopeClassified:classification.hopeClassified,pepClassified:classification.pepClassified},'SelectionCycle');
    }
    if(ranking.tiesResolved) log('RANKING_TIE_RESOLVED',selectionCycleId,{weightVersionId:weights.id,tiedStudentCount:ranking.tiesResolved},'SelectionCycle');
    for(let i=0;i<audits.length;i+=2000) await tx.scoreAuditLog.createMany({data:audits.slice(i,i+2000)});
    return {selectionCycleId,weightVersionId:weights.id,scored:members.length,eligibilityEvaluated:eligibilityRows.length,ranked:ranking.totalStudents,classified:classification.totalStudents,selected:classification.hopeClassified+classification.pepClassified,waitlisted:classification.waitlistedCount,ineligible:classification.notEligibleCount,missingInputs,results:classification.classifiedStudents.map(c=>({studentId:c.studentId,selectionCycleId,program:c.program,rank:c.rank,status:'CLASSIFIED',classifiedAt:now,source:'LIVE' as const}))};
  },{maxWait:10000,timeout:120000});
}
