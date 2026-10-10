import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import { Candidate, identityIndex, mapRecord, Row, SkipRecord, Source } from './mappers';
const SOURCES:Source[]=['SPEAKREADY','READINESS','INTERVIEW'];
type Summary={source:Source;fetched:number;matched:number;inserted:number;duplicates:number;skipped:Record<string,number>;dryRun:boolean;status:string;error?:string};
@Injectable()
export class ExternalScoresService {
  private running=false;
  constructor(private readonly prisma:PrismaService){}
  async status(){
    const jobs=await this.prisma.integrationJob.findMany({where:{operation:'external-scores.pull'},orderBy:{startedAt:'desc'},take:15,include:{source:true,logs:{orderBy:{createdAt:'desc'},take:1}}});
    return {sources:SOURCES.map(source=>({source,configured:Boolean(process.env[`${source}_URL`]&&(source==='INTERVIEW'||process.env[`${source}_API_KEY`])),insecureHttp:process.env[`${source}_URL`]?.startsWith('http:')??false})),
      jobs:jobs.map(j=>({id:j.id,source:j.source.code,status:j.status,startedAt:j.startedAt,endedAt:j.endedAt,summary:j.logs[0]?.details??null}))};
  }
  async sync(source:Source|'ALL'='ALL',dryRun=false){
    if(this.running)throw new ConflictException('An external score fetch is already running');
    this.running=true;
    try{
      const [students,aliases]=await Promise.all([
        this.prisma.student.findMany({where:{isActive:true},select:{id:true,studentId:true,registerNumber:true}}),
        this.prisma.externalReference.findMany({where:{sourceCode:'COLLEGE_ROLL',entityType:'STUDENT'},select:{externalId:true,internalId:true}}),
      ]);
      const resolve=identityIndex(students,aliases),summaries:Summary[]=[];
      for(const selected of source==='ALL'?SOURCES:[source])summaries.push(await this.pull(selected,resolve,dryRun));
      return {summaries,selectionRecalculated:false,allocationsChanged:false};
    }finally{this.running=false;}
  }
  private async read(source:Source,path:string,deadline:number):Promise<any>{
    const configured=process.env[`${source}_URL`];if(!configured)throw new Error('Source is not configured');
    const base=new URL(configured);
    if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw new Error('Invalid source URL');
    if(base.protocol==='http:'&&process.env.EXTERNAL_SCORES_ALLOW_HTTP!=='true')throw new Error('HTTP fetching has not been enabled');
    const key=process.env[`${source}_API_KEY`];if(source!=='INTERVIEW'&&!key)throw new Error('Source key is not configured');
    for(let attempt=0;attempt<3;attempt++){
      const remaining=deadline-Date.now();if(remaining<=0)throw new Error('Source fetch time limit exceeded');
      let response:Response;
      try {
        response=await fetch(new URL(path,base),{headers:key?{'x-api-key':key}:{},redirect:'error',signal:AbortSignal.timeout(Math.min(20000,remaining))});
      } catch (error) {
        const timeout=error instanceof Error&&['TimeoutError','AbortError'].includes(error.name);
        if(attempt<2&&Date.now()<deadline-1000){await new Promise(r=>setTimeout(r,500*(attempt+1)));continue;}
        throw new Error(timeout?'Source request timed out. Retry later.':'Source is unreachable. Check that the upstream API is running and its port is accessible.');
      }
      if([429,502,503,504].includes(response.status)&&attempt<2){await response.body?.cancel();await new Promise(r=>setTimeout(r,500*(attempt+1)));continue;}
      if(!response.ok)throw new Error(`Source returned HTTP ${response.status}`);
      let text:string;
      try {
        const reader=response.body?.getReader();if(!reader)throw new Error('Source returned an empty response');
        const chunks:Uint8Array[]=[];let size=0;
        for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>8*1024*1024){await reader.cancel();throw new Error('Source response is too large');}chunks.push(chunk.value);}
        text=Buffer.concat(chunks).toString('utf8');
      } catch(error) {
        if(error instanceof Error&&error.message.startsWith('Source '))throw error;
        throw new Error('Source response interrupted or timed out. Retry later.');
      }
      try{return JSON.parse(text);}catch{throw new Error('Source returned invalid JSON');}
    }
    throw new Error('Source unavailable');
  }
  private async records(source:Source){
    const deadline=Date.now()+90000,rows:Row[]=[];
    if(source==='INTERVIEW'){
      const interviews=await this.read(source,'/api/admin/schedule/interviews',deadline);
      if(!Array.isArray(interviews)||interviews.length>200)throw new Error('Invalid or oversized interview list');
      for(const interview of interviews){
        if(typeof interview.id!=='string'||!/^[a-f0-9-]{36}$/i.test(interview.id))throw new Error('Invalid interview ID');
        const records=await this.read(source,`/api/admin/schedule/interviews/${interview.id}/attendance`,deadline);
        if(!Array.isArray(records))throw new Error('Invalid attendance response');
        rows.push(...records);if(rows.length>10000)throw new Error('Source record limit exceeded');
      }
      return rows;
    }
    for(let page=1;page<=50;page++){
      const path=source==='SPEAKREADY'?`/api/v1/external/students?updated_since=1970-01-01T00%3A00%3A00Z&page=${page}`:`/api/v1/external/students/results?page=${page}&limit=200`;
      const body=await this.read(source,path,deadline),data=source==='READINESS'?body.data:body;
      if(!data||!Array.isArray(data.students))throw new Error('Invalid student export response');
      rows.push(...data.students);if(rows.length>10000)throw new Error('Source record limit exceeded');
      if(source==='SPEAKREADY'){
        if(data.next_page==null)return rows;if(data.next_page!==page+1)throw new Error('Invalid pagination cursor');
      }else{
        if(typeof data.total!=='number'||data.total<0||!Number.isInteger(data.total))throw new Error('Invalid result total');
        if(rows.length>=data.total)return rows;if(!data.students.length)throw new Error('Incomplete result pagination');
      }
    }
    throw new Error('Pagination limit exceeded; no partial source import performed');
  }
  private async pull(source:Source,resolve:ReturnType<typeof identityIndex>,dryRun:boolean):Promise<Summary>{
    const summary:Summary={source,fetched:0,matched:0,inserted:0,duplicates:0,skipped:{},dryRun,status:'SUCCEEDED'};
    const dbSource=await this.prisma.integrationSource.upsert({where:{code:`PULL_${source}`},create:{code:`PULL_${source}`,name:source},update:{}});
    let job:{id:string};
    try {
      job=await this.prisma.$transaction(async tx=>{
        // Short database-backed lease claim works across API instances. No network I/O in this transaction.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`project9:external-pull:${source}`}))`;
        const cutoff=new Date(Date.now()-10*60_000);
        const active=await tx.integrationJob.findFirst({where:{sourceId:dbSource.id,operation:'external-scores.pull',status:'PROCESSING',startedAt:{gte:cutoff}}});
        if(active)throw new ConflictException('Source fetch is already running. Retry after it finishes.');
        await tx.integrationJob.updateMany({where:{sourceId:dbSource.id,operation:'external-scores.pull',status:'PROCESSING',startedAt:{lt:cutoff}},data:{status:'FAILED',endedAt:new Date(),error:{message:'Worker lease expired'}}});
        return tx.integrationJob.create({data:{sourceId:dbSource.id,operation:'external-scores.pull',method:'API',idempotencyKey:randomUUID()}});
      });
    } catch(error) {
      summary.status='FAILED';summary.error=error instanceof ConflictException?error.message:'Source job could not be started. Please retry.';return summary;
    }
    try{
      const fetchedAt=new Date(),rows=await this.records(source),candidates:Candidate[]=[];
      summary.fetched=rows.length;const unique=new Set<string>();
      for(const row of rows){
        try{
          if(!row||typeof row!=='object'||Array.isArray(row))throw new SkipRecord('invalid');
          const c=mapRecord(source,row,resolve,fetchedAt),key=`${c.student.id}:${c.sourceResultId}`;
          if(unique.has(key)){summary.duplicates++;continue;}unique.add(key);candidates.push(c);
        }catch(e){const reason=e instanceof SkipRecord?e.reason:'invalid';summary.skipped[reason]=(summary.skipped[reason]??0)+1;}
      }
      summary.matched=candidates.length;
      if(!dryRun&&candidates.length){
        // Unique content fingerprints preserve history and make repeated fetches idempotent.
        for(let offset=0;offset<candidates.length;offset+=100){
          const chunk=candidates.slice(offset,offset+100);
          const inserted=source==='READINESS'
            ?await this.prisma.readinessAssessment.createMany({skipDuplicates:true,data:chunk.map(c=>({studentId:c.student.id,sourceResultId:c.sourceResultId,sourceBatchId:`pull:${job.id}`,readinessScore:c.score,verificationStatus:c.verificationStatus,parameterScores:c.parameters as unknown as Prisma.InputJsonValue,assessedAt:c.assessedAt}))})
            :await this.prisma.assessmentResult.createMany({skipDuplicates:true,data:chunk.map(c=>({studentId:c.student.id,sourceIdentifier:c.sourceResultId,assessmentType:c.type as 'COMMUNICATION'|'INTERVIEW',score:c.score,maxScore:c.maxScore,percentage:c.score,assessmentDate:c.assessedAt,metadata:c.metadata as Prisma.InputJsonValue}))});
          summary.inserted+=inserted.count;summary.duplicates+=chunk.length-inserted.count;
        }
      }
      if(Object.keys(summary.skipped).length)summary.status='PARTIAL';
    }catch(e){
      summary.status='FAILED';
      // Do not expose upstream bodies, credentials, transcripts, photos or personal details.
      summary.error=e instanceof Error&&/^(Source |Invalid |Incomplete |Pagination |HTTP )/.test(e.message)?e.message:'External fetch or database write failed';
    }
    await this.prisma.integrationLog.create({data:{jobId:job.id,level:summary.status==='FAILED'?'ERROR':'INFO',message:dryRun?'External score fetch preview':'External score fetch',details:summary as unknown as Prisma.InputJsonValue}});
    await this.prisma.integrationJob.update({where:{id:job.id},data:{status:summary.status==='FAILED'?'FAILED':'SUCCEEDED',recordCount:summary.fetched,endedAt:new Date(),error:summary.error?{message:summary.error}:Prisma.JsonNull}});
    return summary;
  }
}
