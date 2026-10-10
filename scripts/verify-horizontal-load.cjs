// Bounded, read-only smoke test. This is not a sustained capacity certification.
const api='https://project9-api-381809967406.us-central1.run.app/api';
(async()=>{
  if(!process.env.VERIFY_ADMIN_PASSWORD)throw Error('Private verification credential required');
  const login=await fetch(`${api}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'admin@project9.local',password:process.env.VERIFY_ADMIN_PASSWORD}),signal:AbortSignal.timeout(20000)});
  if(!login.ok)throw Error('Authentication failed');
  const {accessToken}=await login.json();
  const start=new Date().toISOString();
  const responses=await Promise.all(Array.from({length:100},async()=>{
    const began=performance.now();
    try {
      const response=await fetch(`${api}/profiles?page=1&sort=readiness_desc`,{headers:{authorization:`Bearer ${accessToken}`},signal:AbortSignal.timeout(45000)});
      await response.arrayBuffer(); // Consume but never print student payloads.
      return {status:response.status,ms:Math.round(performance.now()-began)};
    } catch {return {status:'timeout-or-network-error',ms:Math.round(performance.now()-began)};}
  }));
  const timings=responses.map(response=>response.ms).sort((a,b)=>a-b);
  const statuses=responses.reduce((result,response)=>{result[response.status]=(result[response.status]??0)+1;return result;},{});
  console.log(JSON.stringify({startedAt:start,concurrentReadRequests:100,statuses,p50Ms:timings[49],p95Ms:timings[94],maxMs:timings[99]}));
  if(responses.some(response=>response.status!==200))process.exitCode=1;
})().catch(()=>{console.error('Read-only load verification failed');process.exitCode=1;});
