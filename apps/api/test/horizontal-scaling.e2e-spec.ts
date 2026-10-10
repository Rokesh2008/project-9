import { fork, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/common/prisma.service';
import { createSelectionDemo } from '../src/selection-demo.fixture';

describe('Horizontal safety across independent API processes',()=>{
  let db:PrismaService;
  const children:ChildProcess[]=[];
  const urls:string[]=[];
  let sequence=0;
  const prefix=`horizontal-test-${randomUUID()}`;
  let cycleId:string,trainingBatchId:string,recommendationId:string;
  function command(index:number,operation:string,values:Record<string,unknown>={}) {
    const child=children[index],id=++sequence;
    return new Promise<any>((resolve,reject)=>{
      const timer=setTimeout(()=>{child.off('message',receive);reject(new Error('Worker response timeout'));},15000);
      function receive(message:any){if(message.id===id){clearTimeout(timer);child.off('message',receive);resolve(message);}}
      child.on('message',receive);child.send({id,operation,...values});
    });
  }
  beforeAll(async()=>{
    db=new PrismaService();await db.$connect();
    await db.$executeRawUnsafe('TRUNCATE TABLE "Department", "SelectionCycle", "Program" RESTART IDENTITY CASCADE');
    const cycle=await createSelectionDemo(db);cycleId=cycle.id;
    const program=await db.program.create({data:{code:prefix,name:'Synthetic horizontal test'}});
    const domain=await db.domain.create({data:{programId:program.id,code:'PEPC-987654321',name:prefix}});
    const trainingBatch=await db.trainingBatch.create({data:{domainId:domain.id,batchCode:prefix,batchName:prefix,maxCapacity:1}});trainingBatchId=trainingBatch.id;
    recommendationId=`${prefix}-recommendation`;
    await db.sharedStateRecord.create({data:{namespace:'recommendations',key:recommendationId,value:{id:recommendationId,studentId:'RULEDEMO-1',selectionCycleId:cycleId,recommendedDomain:`${domain.code} ${domain.name}`,rationale:['Synthetic recommendation'],conflicts:[],status:'PENDING_APPROVAL'}}});
    await db.sharedStateRecord.upsert({where:{namespace_key:{namespace:'_system',key:'migration'}},create:{namespace:'_system',key:'migration',value:{test:true}},update:{}});
    for(let index=0;index<2;index++) {
      const child=fork(join(__dirname,'fixtures/horizontal-worker.cjs'),[],{env:{...process.env,HORIZONTAL_STATE:'true',AUTH_REQUIRED:'false',DEMO_MODE:'false'},stdio:['ignore','ignore','pipe','ipc']});
      children.push(child);
      child.setMaxListeners(40); // Concurrent IPC commands each have a bounded listener.
      urls.push(await new Promise<string>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Worker startup timeout')),20000);
        child.on('message',(message:any)=>{if(message.ready){clearTimeout(timer);resolve(message.url);}if(message.startupError){clearTimeout(timer);reject(new Error(message.startupError));}});
        child.once('exit',code=>{if(code){clearTimeout(timer);reject(new Error(`Worker exited ${code}`));}});
      }));
    }
  },60000);
  afterAll(async()=>{
    for(const child of children) {if(child.connected)child.send({operation:'stop'});}
    await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():new Promise<void>(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},5000);child.once('exit',()=>{clearTimeout(timer);resolve();});})));
    await db.sharedStateRecord.deleteMany({where:{key:{startsWith:prefix}}});
    await db.integrationSource.deleteMany({where:{code:{startsWith:prefix}}});
    await db.$disconnect();
  });
  it('serves the same API from two independent processes without sticky sessions',async()=>{
    expect(children[0].pid).not.toBe(children[1].pid);
    for(const url of urls){const response=await fetch(`${url}/api/health/ready`);expect(response.status).toBe(200);}
  });
  it('preserves simultaneous writes to different entities and reads them on the other replica',async()=>{
    const results=await Promise.all([command(0,'write',{key:`${prefix}-a`,value:'A',delay:100}),command(1,'write',{key:`${prefix}-b`,value:'B',delay:100})]);
    expect(results.every(result=>result.result==='committed')).toBe(true);
    expect((await command(1,'read',{key:`${prefix}-a`})).result).toBe('A');
    expect((await command(0,'read',{key:`${prefix}-b`})).result).toBe('B');
  });
  it('rejects a conflicting same-entity write instead of losing an update',async()=>{
    await command(0,'write',{key:`${prefix}-conflict`,value:'original'});
    const results=await Promise.all([command(0,'write',{key:`${prefix}-conflict`,value:'one',delay:400}),command(1,'write',{key:`${prefix}-conflict`,value:'two',delay:400})]);
    expect(results.filter(result=>result.result==='committed')).toHaveLength(1);
    expect(results.filter(result=>result.status===409)).toHaveLength(1);
  });
  it('shares rate-limit windows across API replicas',async()=>{
    const results=await Promise.all(Array.from({length:20},(_,index)=>command(index%2,'limit',{key:`${prefix}-limit`,limit:12})));
    expect(results.filter(result=>result.result?.allowed)).toHaveLength(12);
    expect(results.filter(result=>result.result?.allowed===false)).toHaveLength(8);
  });
  it('rolls back official, nested-service and companion-state writes together',async()=>{
    expect((await command(0,'atomic-rollback',{key:`${prefix}-rollback`})).error).toBe('intentional rollback');
    expect(await db.integrationSource.findUnique({where:{code:`${prefix}-rollback`}})).toBeNull();
    expect((await command(1,'read',{key:`${prefix}-rollback`})).result).toBeUndefined();
  });
  it('uses durable import idempotency across replicas and rejects changed payloads',async()=>{
    const body={sourceBatchId:`${prefix}-batch`,records:[]};
    const headers={'content-type':'application/json','idempotency-key':`${prefix}-import`};
    const first=await fetch(`${urls[0]}/api/integrations/project2/students`,{method:'POST',headers,body:JSON.stringify(body)});
    expect(first.status).toBe(201);
    const second=await fetch(`${urls[1]}/api/integrations/project2/students`,{method:'POST',headers,body:JSON.stringify(body)});
    expect(second.status).toBe(201);expect(await second.json()).toMatchObject({duplicate:true});
    const conflict=await fetch(`${urls[1]}/api/integrations/project2/students`,{method:'POST',headers,body:JSON.stringify({...body,sourceBatchId:'changed'})});
    expect(conflict.status).toBe(409);
  });
  it('serializes same-cycle selection without duplicate rows across replicas',async()=>{
    const responses=await Promise.all(urls.map(url=>fetch(`${url}/api/selection-pipeline/demo/${cycleId}/run`,{method:'POST'})));
    for(const response of responses){expect(response.status).toBe(201);expect(await response.json()).toMatchObject({classified:6,selected:4});}
    expect(await db.studentRanking.count({where:{selectionCycleId:cycleId}})).toBe(6);
  });
  it('commits an approval and capacity claim once when both replicas decide it',async()=>{
    const responses=await Promise.all(urls.map(url=>fetch(`${url}/api/agent/selection/recommendations/${recommendationId}/decision`,{
      method:'POST',headers:{'content-type':'application/json','x-role':'ADMIN','x-actor-id':'synthetic-admin'},body:JSON.stringify({decision:'APPROVE',approverId:'synthetic-admin'}),
    })));
    expect(responses.map(response=>response.status).sort()).toEqual([201,400]);
    expect((await db.trainingBatch.findUniqueOrThrow({where:{id:trainingBatchId}})).currentAllocated).toBe(1);
    expect(await db.allocation.count({where:{selectionCycleId:cycleId,trainingBatchId}})).toBe(1);
    const record=await db.sharedStateRecord.findUniqueOrThrow({where:{namespace_key:{namespace:'recommendations',key:recommendationId}}});
    expect(record.value).toMatchObject({status:'VERIFIED'});
  });
  it('executes a scheduled freeze only once across replicas',async()=>{
    const scheduled=await fetch(`${urls[0]}/api/freeze/schedule`,{method:'POST',headers:{'content-type':'application/json','x-actor-id':'synthetic-admin'},body:JSON.stringify({selectionCycleId:cycleId,scheduledAt:new Date(Date.now()+3600000).toISOString()})});
    expect(scheduled.status).toBe(201);
    const responses=await Promise.all(urls.map(url=>fetch(`${url}/api/freeze/${cycleId}/execute`,{method:'POST',headers:{'content-type':'application/json','x-actor-id':'synthetic-admin'},body:JSON.stringify({reason:'Synthetic concurrent freeze test'})})));
    expect(responses.map(response=>response.status).sort()).toEqual([201,409]);
    expect(await db.rankingSnapshot.count({where:{selectionCycleId:cycleId}})).toBe(1);
  });
});
