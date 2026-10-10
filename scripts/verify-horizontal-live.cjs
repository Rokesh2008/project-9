// Credentials enter through the environment only. Outputs counts/hashes/timing,
// never student payloads, account identifiers, tokens or connection strings.
const { PrismaClient, Prisma }=require('../apps/api/node_modules/@prisma/client');
const db=new PrismaClient();
const api='https://project9-api-381809967406.us-central1.run.app/api';
const demoId='d2b99a39-397d-451f-aefd-2b3e578ddc60';
const tables=['StudentScore','EligibilityResult','StudentRanking','HopePepClassification','StudentCycleStatus','WorkflowAuditLog','Allocation','AdminDecision','ScoreAuditLog'];
const hashes=async()=>Object.fromEntries(await Promise.all(tables.map(async table=>{
  const [row]=await db.$queryRaw(Prisma.sql`SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]')) AS hash FROM ${Prisma.raw(`"${table}"`)} t WHERE "selectionCycleId" <> ${demoId}`);
  return [table,row.hash];
})));
(async()=>{
  const before=await hashes();
  const counts={students:await db.student.count(),accounts:await db.user.count()};
  if(process.argv[2]==='--hash-only'){console.log(JSON.stringify({counts,hashes:before}));return;}
  if(!process.env.VERIFY_ADMIN_PASSWORD)throw Error('Private verification credential required');
  const login=await fetch(`${api}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@project9.local',password:process.env.VERIFY_ADMIN_PASSWORD}),signal:AbortSignal.timeout(30000)});
  if(!login.ok)throw Error(`Authentication status ${login.status}`);
  const {accessToken}=await login.json();
  const headers={authorization:`Bearer ${accessToken}`};
  const timings={};
  async function get(route){const started=performance.now();const response=await fetch(`${api}${route}`,{headers,signal:AbortSignal.timeout(40000)});if(!response.ok)throw Error(`Read status ${response.status}`);const result=await response.json();timings[route]=Math.round(performance.now()-started);return result;}
  const [directory,recommendations,logs]=await Promise.all([get('/profiles?page=1&sort=readiness_desc'),get('/agent/selection/recommendations'),get('/integrations/logs')]);
  const ready=await fetch(`${api}/health/ready`,{signal:AbortSignal.timeout(15000)});
  const unauthorized=await fetch(`${api}/profiles`,{signal:AbortSignal.timeout(15000)});
  let demo;
  if(process.argv[2]==='--demo') {
    const status=await get(`/selection-pipeline/demo/${demoId}`);
    // Explicitly scoped endpoint performs its own six-synthetic-student guard.
    if(!JSON.stringify(status).includes('LIVE-RULES-DEMO-20261009'))throw Error('Synthetic cycle guard mismatch');
    const started=performance.now();
    const response=await fetch(`${api}/selection-pipeline/demo/${demoId}/run`,{method:'POST',headers,signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw Error(`Synthetic selection status ${response.status}`);
    const result=await response.json();
    demo={durationMs:Math.round(performance.now()-started),classified:result.classified,selected:result.selected,waitlisted:result.waitlisted,ineligible:result.ineligible};
  }
  const after=await hashes();
  const realDataUnchanged=JSON.stringify(before)===JSON.stringify(after);
  console.log(JSON.stringify({counts,directoryTotal:directory.total??directory.pagination?.total,recommendations:recommendations.length,integrationLogs:logs.length,readyStatus:ready.status,unauthenticatedStatus:unauthorized.status,timings,demo,realDataUnchanged,hashes:after}));
  if(!realDataUnchanged||ready.status!==200||unauthorized.status!==401)process.exitCode=1;
})().catch(error=>{console.error(`Live verification failed (${error.name}); payloads and credentials suppressed.`);process.exitCode=1;}).finally(()=>db.$disconnect());
