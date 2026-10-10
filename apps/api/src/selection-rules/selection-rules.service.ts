import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuthPrincipal } from '../auth/auth.service';
import { READINESS_PARAMETERS } from '../readiness/readiness.catalog';
import { evaluateEligibility, RuleConfiguration, StudentContext, validateRuleConfiguration } from '../member1/eligibility/eligibility.engine';
import { RulePolicyDto, PreviewRulePolicyDto } from './selection-rules.dto';

export const SELECTION_RULE_FIELDS = [
 {key:'cgpa',label:'CGPA',max:10}, {key:'attendancePercent',label:'Attendance (%)',max:100},
 {key:'codingScore',label:'Coding score',max:null}, {key:'aptitudeScore',label:'Aptitude score',max:null},
 {key:'communicationScore',label:'Communication score',max:null}, {key:'interviewScore',label:'Interview score',max:null},
 {key:'certificateCount',label:'Verified certificate count',max:null},
 {key:'readinessScore',label:'Verified readiness total (out of 250)',max:250},
 ...READINESS_PARAMETERS.map(p=>({key:p.key,label:`${p.label} (verified / ${p.maxScore})`,max:p.maxScore})),
];

export function validatePolicy(input: RulePolicyDto) {
 const errors=validateRuleConfiguration({rules:input.rules,logic:input.logic});
 if(!input.name?.trim())errors.push('Version name cannot be blank');
 for(const r of input.rules ?? []) {
  const f=SELECTION_RULE_FIELDS.find(f=>f.key===r.field);
  if(!f)errors.push(`Unsupported selection field: ${r.field}`);
  if(!['GTE','LTE','GT','LT','EQ','NEQ','EXISTS'].includes(r.operator))errors.push('Unsupported comparison operator');
  if(r.operator!=='EXISTS' && (typeof r.value!=='number'||!Number.isFinite(r.value)||r.value<0||f?.max!=null&&r.value>f.max))errors.push(`Invalid numeric threshold for ${r.field}`);
  if(r.field==='certificateCount'&&r.operator!=='EXISTS'&&!Number.isInteger(r.value))errors.push('Certificate threshold must be an integer');
 }
 if(errors.length)throw new BadRequestException(errors);
}

@Injectable()
export class SelectionRulesService {
 constructor(private readonly prisma:PrismaService){}
 assertScope(user:AuthPrincipal,domainId?:string|null){
  if(user.role==='ADMIN')return;
  if(user.role==='PEP_STAFF'&&domainId&&user.facultyDomainId===domainId)return;
  throw new ForbiddenException('Only admins or faculty assigned to this domain can change selection rules');
 }
 async assertCycle(id:string,mutation=false){
  const cycle=await this.prisma.selectionCycle.findUnique({where:{id}});
  if(!cycle)throw new NotFoundException('Selection cycle not found');
  if(mutation&&cycle.status==='FROZEN')throw new BadRequestException('Frozen cycle rules cannot be changed');
  return cycle;
 }
 async metadata(user:AuthPrincipal){
  if(!['ADMIN','PEP_STAFF','COORDINATOR'].includes(user.role))throw new ForbiddenException();
  const [cycles,domains]=await Promise.all([
   this.prisma.selectionCycle.findMany({orderBy:{createdAt:'desc'},select:{id:true,code:true,name:true,status:true}}),
   this.prisma.domain.findMany({where:{isActive:true},orderBy:{name:'asc'},select:{id:true,code:true,name:true}}),
  ]);
  return {cycles,domains,fields:SELECTION_RULE_FIELDS};
 }
 async list(cycleId:string,user:AuthPrincipal){
  if(!['ADMIN','PEP_STAFF','COORDINATOR'].includes(user.role))throw new ForbiddenException();
  await this.assertCycle(cycleId);
  const policies=await this.prisma.selectionRulePolicy.findMany({where:{selectionCycleId:cycleId},orderBy:{createdAt:'desc'}});
  const baseline=await this.prisma.eligibilityRuleVersion.findMany({where:{selectionCycleId:cycleId,isActive:true},select:{id:true,rules:true,description:true}});
  return {baseline,policies:policies.map(p=>({...p,canEdit:user.role==='ADMIN'||user.role==='PEP_STAFF'&&p.domainId===user.facultyDomainId}))};
 }
 async create(input:RulePolicyDto,user:AuthPrincipal){
  this.assertScope(user,input.domainId);validatePolicy(input);await this.assertCycle(input.selectionCycleId,true);
  if(input.domainId&&!await this.prisma.domain.findFirst({where:{id:input.domainId,isActive:true}}))throw new BadRequestException('Active domain not found');
  return this.prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "SelectionCycle" WHERE "id"=${input.selectionCycleId} FOR UPDATE`;
   const c=await tx.selectionCycle.findUnique({where:{id:input.selectionCycleId}});if(c?.status==='FROZEN')throw new BadRequestException('Frozen cycle rules cannot be changed');
   const p=await tx.selectionRulePolicy.create({data:{selectionCycleId:input.selectionCycleId,domainId:input.domainId??null,scopeKey:input.domainId??'GLOBAL',program:input.program,name:input.name.trim(),rules:{rules:input.rules,logic:input.logic} as unknown as Prisma.InputJsonValue,createdBy:user.sub}});
   await this.audit(tx,p.selectionCycleId,p.id,'SELECTION_RULE_DRAFT_CREATED',user);
   return p;
  });
 }
 async setActive(id:string,active:boolean,user:AuthPrincipal){
  const p=await this.prisma.selectionRulePolicy.findUnique({where:{id}});if(!p)throw new NotFoundException('Rule version not found');
  this.assertScope(user,p.domainId);await this.assertCycle(p.selectionCycleId,true);
  return this.prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "SelectionCycle" WHERE "id"=${p.selectionCycleId} FOR UPDATE`;
   const c=await tx.selectionCycle.findUnique({where:{id:p.selectionCycleId}});if(c?.status==='FROZEN')throw new BadRequestException('Frozen cycle rules cannot be changed');
   if(active)await tx.selectionRulePolicy.updateMany({where:{selectionCycleId:p.selectionCycleId,scopeKey:p.scopeKey,program:p.program,isActive:true},data:{isActive:false}});
   const updated=await tx.selectionRulePolicy.update({where:{id},data:{isActive:active,activatedBy:user.sub,activatedAt:new Date()}});
   await this.audit(tx,p.selectionCycleId,id,active?'SELECTION_RULE_ACTIVATED':'SELECTION_RULE_DEACTIVATED',user);
   return updated;
  });
 }
 private audit(tx:Prisma.TransactionClient,cycle:string,id:string,action:string,user:AuthPrincipal){return tx.scoreAuditLog.create({data:{selectionCycleId:cycle,entityType:'SelectionRulePolicy',entityId:id,action,actor:user.sub,role:user.role}});}
 async context(studentId:string,cycleId?:string){
  const s=await this.prisma.student.findUnique({where:{id:studentId},include:{assessmentResults:true,credentials:{where:{verificationStatus:'VERIFIED'}}}});
  if(!s)throw new NotFoundException('Student not found');
  const preferences=cycleId?await this.prisma.studentPreference.findMany({where:{studentId,selectionCycleId:cycleId},orderBy:{preferenceRank:'asc'},include:{domain:true}}):[];
  const context:StudentContext={studentId:s.studentId,registerNumber:s.registerNumber,name:s.name,email:s.email,isActive:s.isActive,batchId:s.batchId,cgpa:s.cgpa,attendancePercent:s.attendancePercent,dsaLevel:s.dsaLevel,certificateCount:s.credentials.length,verifiedCertificates:s.credentials.map(c=>c.name),preferences:preferences.map(p=>p.domain.code),preferenceCount:preferences.length};
  for(const r of s.assessmentResults){const key=`${r.assessmentType.toLowerCase()}Score`;if(context[key]===undefined||r.score>Number(context[key]))context[key]=r.score;context[`${r.assessmentType.toLowerCase()}MaxScore`]=r.maxScore;if(r.percentage!==null)context[`${r.assessmentType.toLowerCase()}Percentage`]=r.percentage;}
  Object.assign(context,await this.readinessContext(studentId));return context;
 }
 async readinessContext(studentId:string){
  const latest=await this.prisma.readinessAssessment.findFirst({where:{studentId},orderBy:[{assessedAt:'desc'},{createdAt:'desc'}]});
  const context:StudentContext={readinessScore:latest?.verificationStatus==='VERIFIED'?latest.readinessScore:null};
  const modules=(latest?.parameterScores??[]) as Array<{parameterKey:string;rawScore:number|null;verificationStatus:string}>;
  for(const f of READINESS_PARAMETERS){const m=modules.find(m=>m.parameterKey===f.key);context[f.key]=m?.verificationStatus==='VERIFIED'?m.rawScore:null;}
  return context;
 }
 async evaluate(studentId:string,cycleId:string,domainId?:string|null,program?:string){
  const scopes=['GLOBAL',...(domainId?[domainId]:[])];
  const programs=['BOTH',...(['HOPE','PEP'].includes(program??'')?[program!]:[])];
  const policies=await this.prisma.selectionRulePolicy.findMany({where:{selectionCycleId:cycleId,scopeKey:{in:scopes},program:{in:programs},isActive:true},orderBy:{createdAt:'asc'}});
  if(!policies.length)return {isEligible:true,results:[]};
  const context=await this.context(studentId);
  const results=policies.map(p=>({policyId:p.id,name:p.name,domainId:p.domainId,program:p.program,...evaluateEligibility(context,p.rules as unknown as RuleConfiguration)}));
  return {isEligible:results.every(r=>r.isEligible),results};
 }
 async preview(input:PreviewRulePolicyDto,user:AuthPrincipal){
  this.assertScope(user,input.domainId);validatePolicy(input);await this.assertCycle(input.selectionCycleId);
  const s=await this.prisma.student.findUnique({where:{registerNumber:input.registerNumber.trim().toUpperCase()}});if(!s)throw new NotFoundException('Student register number not found');
  const context=await this.context(s.id,input.selectionCycleId);
  const proposed=evaluateEligibility(context,{rules:input.rules,logic:input.logic});
  const baseline=await this.prisma.eligibilityRuleVersion.findFirst({where:{selectionCycleId:input.selectionCycleId,isActive:true},orderBy:{version:'desc'}});
  const college=baseline?evaluateEligibility(context,baseline.rules as unknown as RuleConfiguration):null;
  const active=await this.evaluate(s.id,input.selectionCycleId,input.domainId,input.program);
  return {student:{registerNumber:s.registerNumber,name:s.name},proposed,college,active,previewOnly:true,notice:'Preview does not select, rank, approve or allocate this student. Active version of the same scope/program will be replaced on activation; other rules still apply.'};
 }
 async assertAllocation(studentId:string,cycleId:string,domainId:string){
  const result=await this.prisma.hopePepClassification.findUnique({where:{studentId_selectionCycleId:{studentId,selectionCycleId:cycleId}}});
  if(!result&&await this.prisma.selectionRulePolicy.count({where:{selectionCycleId:cycleId,isActive:true,scopeKey:{in:['GLOBAL',domainId]}}}))throw new BadRequestException('Run official selection before allocating a student under custom rules');
  if(result&&!['HOPE','PEP'].includes(result.program))throw new BadRequestException('Student is not selected for HOPE or PEP');
  const evaluation=await this.evaluate(studentId,cycleId,domainId,result?.program);
  if(!evaluation.isEligible)throw new BadRequestException({message:'Student does not meet active domain/program selection rules',failedPolicies:evaluation.results.filter(r=>!r.isEligible)});
 }
}
