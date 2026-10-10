// Synthetic local-only test. Never accepts production URLs or databases.
const {PrismaClient}=require('@prisma/client');
const {randomBytes,scryptSync}=require('node:crypto');
const database=new URL(process.env.DATABASE_URL??''),base=new URL(process.env.LOAD_API_URL??'http://127.0.0.1:4310/api');
if(!['localhost','127.0.0.1'].includes(database.hostname)||!/^\/project9_.*test.*$/.test(database.pathname)||!['localhost','127.0.0.1'].includes(base.hostname))throw new Error('Load tests require an isolated local database and loopback API');
const db=new PrismaClient();
async function main(){
 const password=randomBytes(24).toString('base64url'),salt=randomBytes(16).toString('hex');
 const hash=`scrypt$${salt}$${scryptSync(password,salt,64).toString('hex')}`;
 const department=await db.department.upsert({where:{code:'SCALE-LOAD-TEST'},create:{code:'SCALE-LOAD-TEST',name:'Synthetic load test'},update:{}});
 const batch=await db.batch.upsert({where:{batchIdentifier:'SCALE-LOAD-TEST-100'},create:{batchIdentifier:'SCALE-LOAD-TEST-100',academicYear:'TEST',departmentId:department.id},update:{}});
 for(let i=0;i<100;i++){
  const student=await db.student.upsert({where:{studentId:`SCALE-100-${i}`},create:{studentId:`SCALE-100-${i}`,registerNumber:`SCALE-100-${i}`,name:`Synthetic student ${i}`,batchId:batch.id},update:{}});
  await db.user.upsert({where:{email:`scale-${i}@load.invalid`},create:{email:`scale-${i}@load.invalid`,name:`Synthetic user ${i}`,password:hash,role:'STUDENT',studentId:student.id},update:{password:hash,isActive:true}});
 }
 const timings=[],codes={};let failures=0;
 async function request(path,init){const start=performance.now();const r=await fetch(`${base.href.replace(/\/$/,'')}${path}`,{...init,signal:AbortSignal.timeout(30000)});codes[r.status]=(codes[r.status]??0)+1;const data=await r.json();timings.push(performance.now()-start);if(!r.ok)throw new Error(`HTTP ${r.status}`);return data;}
 const started=performance.now();
 await Promise.all(Array.from({length:100},async(_,i)=>{try{
  const login=await request('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`scale-${i}@load.invalid`,password})});
  const profile=await request('/profiles/me',{headers:{Authorization:`Bearer ${login.accessToken}`}});
  if(profile.student.studentId!==`SCALE-100-${i}`)throw new Error('Profile isolation failure');
 }catch{failures++;}}));
 timings.sort((a,b)=>a-b);
 console.log(JSON.stringify({environment:'isolated-local-only',simultaneousUsers:100,requests:timings.length,statusCodes:codes,failures,totalMs:Math.round(performance.now()-started),p95RequestMs:Math.round(timings[Math.ceil(timings.length*.95)-1]),productionCapacityCertified:false}));
 if(failures)process.exitCode=1;
}
main().catch(e=>{console.error(e.name,'Synthetic load test failed');process.exitCode=1}).finally(()=>db.$disconnect());
