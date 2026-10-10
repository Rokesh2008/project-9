// Run against an explicitly supplied DATABASE_URL. Never prints payloads or URLs.
// Migrations create tables; this separately copies state only after write drain.
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client');
const { createHash } = require('node:crypto');
const db = new PrismaClient();
const maps = ['students','communicationResults','interviewResults','idempotency','analyses','recommendations','allocations'];
const arrays = ['logs','auditEvents'];
const mode = process.argv[2];
if (!['--check','--import','--export-for-rollback'].includes(mode)) throw new Error('Use --check, --import, or --export-for-rollback');
if (mode !== '--check' && process.env.PROJECT9_WRITES_QUIESCED !== 'true') throw new Error('Pause writes and drain every old writer first; set PROJECT9_WRITES_QUIESCED=true only after verification');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

(async()=>{
  const result = await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('project9-state-cutover',0))::text`;
    if(mode === '--export-for-rollback') {
      const rows = await tx.sharedStateRecord.findMany({orderBy:[{createdAt:'asc'},{key:'asc'}]});
      if(!rows.some(row=>row.namespace==='_system'&&row.key==='migration')) throw new Error('No completed cutover to export');
      const state = Object.fromEntries([...maps,...arrays].map(name=>[name,[]]));
      for(const row of rows) {
        if(maps.includes(row.namespace)) state[row.namespace].push([row.key,row.value]);
        else if(arrays.includes(row.namespace)) state[row.namespace].push(row.value);
      }
      await tx.runtimeState.upsert({where:{id:'main'},create:{id:'main',payload:state},update:{payload:state}});
      return {mode:'rollback-exported',sha256:hash(state),counts:Object.fromEntries(Object.entries(state).map(([key,value])=>[key,value.length]))};
    }
    const saved = await tx.$queryRaw`SELECT "payload", "updatedAt" FROM "RuntimeState" WHERE "id" = 'main' FOR UPDATE`;
    const state = saved[0]?.payload ?? {};
    const entries = [];
    for(const namespace of maps) {
      if(state[namespace]!==undefined&&!Array.isArray(state[namespace])) throw new Error(`Invalid source namespace: ${namespace}`);
      for(const pair of state[namespace]??[]) {
        if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string') throw new Error(`Invalid source entry: ${namespace}`);
        entries.push({namespace,key:pair[0],value:pair[1]});
      }
    }
    for(const namespace of arrays) {
      if(state[namespace]!==undefined&&!Array.isArray(state[namespace])) throw new Error(`Invalid source namespace: ${namespace}`);
      for(const [index,value]of(state[namespace]??[]).entries()) entries.push({namespace,key:`legacy-${String(index).padStart(12,'0')}-${hash(value)}`,value});
    }
    const keys=new Set(),pending=new Set();
    for(const row of entries) {
      const key=`${row.namespace}\0${row.key}`;
      if(keys.has(key))throw new Error('Duplicate source entity key; resolve before migration');
      keys.add(key);
      if(row.namespace==='recommendations'&&row.value.status==='PENDING_APPROVAL') {
        const identity=`${row.value.studentId}\0${row.value.selectionCycleId??''}`;
        if(pending.has(identity))throw new Error('Duplicate pending recommendations; resolve before migration');
        pending.add(identity);
      }
    }
    const metadata={sourceSha256:hash(state),sourceUpdatedAt:saved[0]?.updatedAt??null,counts:Object.fromEntries([...maps,...arrays].map(name=>[name,(state[name]??[]).length]))};
    if(mode==='--check') return {mode:'validated',...metadata};
    const existing=await tx.sharedStateRecord.count();
    if(existing)throw new Error('Destination is not empty. Refusing to overwrite a previous cutover');
    const backupId='horizontal-cutover-backup-20261009';
    await tx.runtimeState.upsert({where:{id:backupId},create:{id:backupId,payload:state},update:{}});
    metadata.backupId=backupId;
    for(let offset=0;offset<entries.length;offset+=1000)await tx.sharedStateRecord.createMany({data:entries.slice(offset,offset+1000)});
    if(await tx.sharedStateRecord.count()!==entries.length)throw new Error('Copy count mismatch');
    await tx.sharedStateRecord.create({data:{namespace:'_system',key:'migration',value:metadata}});
    return {mode:'imported',...metadata};
  },{maxWait:10000,timeout:120000});
  console.log(JSON.stringify(result));
})().catch(error=>{console.error(`State cutover failed (${error.name}). No credentials or payloads logged.`);process.exitCode=1;}).finally(()=>db.$disconnect());
