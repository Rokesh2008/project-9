// Narrow fallback for environments where Prisma's schema engine cannot connect
// but its runtime driver can. Applies ONLY this reviewed additive migration,
// including its exact checksum/history entry in the same PostgreSQL transaction.
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const name='20261009000000_horizontal_state';
const sql=readFileSync(join(__dirname,'../apps/api/prisma/migrations',name,'migration.sql'),'utf8');
const checksum=createHash('sha256').update(sql).digest('hex');
const db=new PrismaClient();
(async()=>{
  const result=await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('project9-horizontal-schema',0))::text`;
    const rows=await tx.$queryRaw`SELECT checksum, finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name = ${name}`;
    if(rows.some(row=>!row.finished_at&&!row.rolled_back_at))throw new Error('Unresolved migration failure');
    const completed=rows.find(row=>row.finished_at&&!row.rolled_back_at);
    if(completed){if(completed.checksum!==checksum)throw new Error('Migration checksum mismatch');return 'already-applied';}
    const tables=await tx.$queryRaw`SELECT to_regclass('public."SharedStateRecord"')::text AS state, to_regclass('public."RateLimitWindow"')::text AS limits`;
    if(tables[0].state||tables[0].limits)throw new Error('Tables exist without matching completed migration; refusing overwrite');
    for(const statement of sql.replace(/--[^\n]*/g,'').split(';').map(value=>value.trim()).filter(Boolean))await tx.$executeRawUnsafe(statement);
    await tx.$executeRaw`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES (${randomUUID()},${checksum},${name},NOW(),NOW(),1)`;
    return 'applied';
  },{maxWait:10000,timeout:30000});
  console.log(JSON.stringify({migration:name,status:result,checksum}));
})().catch(error=>{console.error(`Schema application failed (${error.name}); transaction rolled back.`);process.exitCode=1;}).finally(()=>db.$disconnect());
