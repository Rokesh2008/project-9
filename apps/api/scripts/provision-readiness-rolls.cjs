// Explicit operator-only provisioning. Never runs from a public endpoint.
// Default dry run; --apply resets STUDENT passwords only. Other roles unchanged.
const {PrismaClient}=require('@prisma/client');
const {randomBytes,randomUUID,scrypt}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {identityIndex,mapRecord}=require('../dist/external-scores/mappers');
const db=new PrismaClient();
const norm=v=>String(v??'').trim().toUpperCase();
async function hash(password){const salt=randomBytes(16).toString('hex');const key=await new Promise((resolve,reject)=>scrypt(password,salt,64,(e,k)=>e?reject(e):resolve(k)));return `scrypt$${salt}$${key.toString('hex')}`;}
async function main(){
 const apply=process.argv.includes('--apply');
 if(!process.env.READINESS_URL||!process.env.READINESS_API_KEY)throw Error('Provider configuration required');
 const snapshotArg=process.argv.find(a=>a.startsWith('--snapshot='));const cached=snapshotArg?JSON.parse(fs.readFileSync(snapshotArg.slice(11),'utf8')):null;
 const fetchedAt=cached?new Date(cached.fetchedAt):new Date(),rows=cached?cached.rows:[];let total=cached?.total;
 for(let page=1;!cached&&page<=50;page++){
  const url=new URL(`/api/v1/external/students/results?page=${page}&limit=200`,process.env.READINESS_URL);
  const response=await fetch(url,{headers:{'x-api-key':process.env.READINESS_API_KEY},signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!response.ok)throw Error(`Provider HTTP ${response.status}`);
  const body=await response.json();if(!Array.isArray(body?.data?.students)||!Number.isInteger(body.data.total))throw Error('Invalid provider response');
  if(total!==undefined&&total!==body.data.total)throw Error('Provider changed during pagination');total=body.data.total;
  rows.push(...body.data.students);if(rows.length>=total)break;if(!body.data.students.length)throw Error('Incomplete pagination');
 }
 if(rows.length!==total||total>10000)throw Error('Incomplete or oversized roster');
 if(!cached&&process.env.PROVISION_BACKUP_DIR){fs.mkdirSync(process.env.PROVISION_BACKUP_DIR,{recursive:true,mode:0o700});const snapshot=path.join(process.env.PROVISION_BACKUP_DIR,`readiness-source-${Date.now()}.json`);fs.writeFileSync(snapshot,JSON.stringify({fetchedAt,total,rows}),{mode:0o600,flag:'wx'});console.log(JSON.stringify({sourceSnapshot:snapshot}));}
 const rolls=new Set(),issues={missingName:0,missingDepartment:0,missingBatch:0,duplicateRoll:0};for(const row of rows){row.provider_roll_number=norm(row.roll_number);row.roll_number=row.provider_roll_number.split('@')[0];if(!String(row.name??'').trim())issues.missingName++;if(!row.department)issues.missingDepartment++;if(!row.batch)issues.missingBatch++;if(rolls.has(row.roll_number))issues.duplicateRoll++;rolls.add(row.roll_number);mapRecord('READINESS',row,()=>({id:row.roll_number,studentId:row.roll_number,registerNumber:null}),fetchedAt);}if(Object.values(issues).some(n=>n))throw Error(`Provider identity checks failed: ${JSON.stringify(issues)}`);
 const excluded=rows.filter(r=>!/^[A-Z0-9-]{3,40}$/.test(r.roll_number));for(let i=rows.length-1;i>=0;i--)if(!/^[A-Z0-9-]{3,40}$/.test(rows[i].roll_number))rows.splice(i,1);
 const [students,aliases,users]=await Promise.all([db.student.findMany({include:{user:true}}),db.externalReference.findMany({where:{sourceCode:'COLLEGE_ROLL',entityType:'STUDENT'}}),db.user.findMany()]);
 const index=new Map();const add=(key,id)=>{key=norm(key);if(!key)return;const set=index.get(key)??new Set();set.add(id);index.set(key,set);};
 for(const s of students){add(s.studentId,s.id);add(s.registerNumber,s.id);add(s.user?.loginIdentifier,s.id);}for(const a of aliases)add(a.externalId,a.internalId);
 const byId=new Map(students.map(s=>[s.id,s]));const targets=rows.map(row=>{const ids=new Set([row.roll_number,row.register_number].flatMap(v=>[...(index.get(norm(v))??[])]));if(ids.size>1)throw Error('Ambiguous roster match; nothing changed');const student=byId.get([...ids][0]);if(student?.user&&student.user.role!=='STUDENT')throw Error('Non-student account collision');const owner=users.find(u=>u.loginIdentifier===row.roll_number);if(owner&&owner.studentId!==student?.id)throw Error('Login identifier collision');const email=`${row.roll_number.toLowerCase()}@students.project9.local`;if(!student?.user&&users.some(u=>u.email===email))throw Error('Internal account address collision');return {row,student};});
 const targetIds=targets.map(t=>t.student?.id).filter(Boolean),blockedStudentIds=new Set(targetIds.filter((id,i)=>targetIds.indexOf(id)!==i));
 const conflicts=targets.filter(t=>blockedStudentIds.has(t.student?.id)).map(t=>({roll:t.row.roll_number,registerNumber:t.student.registerNumber,providerName:t.row.name,rosterName:t.student.name}));
 const blockedRolls=new Set(conflicts.map(c=>c.roll));for(let i=targets.length-1;i>=0;i--)if(blockedRolls.has(targets[i].row.roll_number))targets.splice(i,1);for(let i=rows.length-1;i>=0;i--)if(blockedRolls.has(rows[i].roll_number))rows.splice(i,1);
 const byStudent=new Map(targets.filter(t=>t.student).map(t=>[t.student.id,t.row.roll_number]));
 const oldAccounts=process.argv.includes('--provider-only')?[]:users.filter(u=>u.role==='STUDENT'&&!byStudent.has(u.studentId)&&!blockedStudentIds.has(u.studentId));
 const oldPlans=oldAccounts.map(user=>{const known=[...new Set(aliases.filter(a=>a.internalId===user.studentId&&!a.externalId.includes('@')).map(a=>norm(a.externalId)))];if(known.length>1)throw Error('Ambiguous existing roll aliases');return {user,roll:user.loginIdentifier??known[0]??null};});
 const requested=new Map();for(const t of targets)requested.set(t.row.roll_number,t.student?.user?.id??`new:${t.row.roll_number}`);for(const p of oldPlans){if(p.roll&&requested.has(p.roll)&&requested.get(p.roll)!==p.user.id)throw Error('Roll collision between old and provider accounts');if(p.roll)requested.set(p.roll,p.user.id);}
 const summary={sourceRecords:total,providerRecords:rows.length,malformedProviderRecordsSkipped:excluded.length,conflictingProviderRecordsSkipped:conflicts.length,conflictingExistingAccountsUnchanged:blockedStudentIds.size,studentsToCreate:targets.filter(t=>!t.student).length,accountsToCreate:targets.filter(t=>!t.student?.user).length,existingProviderAccounts:targets.filter(t=>t.student?.user).length,otherStudentPasswordsToReset:oldPlans.length,existingAccountsWithoutRoll:oldPlans.filter(p=>!p.roll).length};
 if(!apply){console.log(JSON.stringify({mode:'dry-run',...summary}));return;}
 if(!process.env.STUDENT_INITIAL_PASSWORD||!process.env.PROVISION_BACKUP_DIR||!path.isAbsolute(process.env.PROVISION_BACKUP_DIR))throw Error('Password and absolute private backup directory required');
 fs.mkdirSync(process.env.PROVISION_BACKUP_DIR,{recursive:true,mode:0o700});
 const backup=path.join(process.env.PROVISION_BACKUP_DIR,`roll-login-before-${Date.now()}.json`);
 fs.writeFileSync(backup,JSON.stringify({createdAt:fetchedAt,students,aliases,studentUsers:users.filter(u=>u.role==='STUDENT'),excluded,conflicts }),{mode:0o600,flag:'wx'});
 const deptCode=row=>`READINESS-${norm(row.department).replace(/[^A-Z0-9]+/g,'-')}`;
 const newTargets=targets.filter(t=>!t.student),departments=[...new Map(newTargets.map(t=>[deptCode(t.row),{code:deptCode(t.row),name:String(t.row.department)}])).values()];
 await db.department.createMany({data:departments,skipDuplicates:true});
 const departmentIds=new Map((await db.department.findMany({where:{code:{in:departments.map(d=>d.code)}}})).map(d=>[d.code,d.id]));
 const batchCode=row=>`READINESS-${String(row.batch)}-${deptCode(row)}`;
 const batches=[...new Map(newTargets.map(t=>[batchCode(t.row),{batchIdentifier:batchCode(t.row),academicYear:String(t.row.batch),departmentId:departmentIds.get(deptCode(t.row))}])).values()];
 await db.batch.createMany({data:batches,skipDuplicates:true});
 const batchIds=new Map((await db.batch.findMany({where:{batchIdentifier:{in:batches.map(b=>b.batchIdentifier)}}})).map(b=>[b.batchIdentifier,b.id]));
 const plan=[...targets,...oldPlans.map(p=>({old:p}))];let created=0,reset=0;
 for(let offset=0;offset<plan.length;offset+=50){const chunk=plan.slice(offset,offset+50);const hashes=[];for(let i=0;i<chunk.length;i+=4)hashes.push(...await Promise.all(chunk.slice(i,i+4).map(()=>hash(process.env.STUDENT_INITIAL_PASSWORD))));
  const newStudents=[],newUsers=[],updates=[],references=[];
  for(let i=0;i<chunk.length;i++){const item=chunk[i];if(item.old){updates.push({id:item.old.user.id,password:hashes[i],loginIdentifier:item.old.roll});continue;}const {row}=item;
   if(!item.student){item.student={id:randomUUID(),studentId:row.roll_number,registerNumber:null,name:String(row.name).trim(),batchId:batchIds.get(batchCode(row))};newStudents.push(item.student);}
   references.push({sourceCode:'COLLEGE_ROLL',entityType:'STUDENT',externalId:row.roll_number,internalId:item.student.id});
   if(row.provider_roll_number!==row.roll_number)references.push({sourceCode:'COLLEGE_ROLL',entityType:'STUDENT',externalId:row.provider_roll_number,internalId:item.student.id});
   if(item.student.user)updates.push({id:item.student.user.id,password:hashes[i],loginIdentifier:row.roll_number});else newUsers.push({email:`${row.roll_number.toLowerCase()}@students.project9.local`,loginIdentifier:row.roll_number,name:String(row.name).trim(),studentId:item.student.id,role:'STUDENT',password:hashes[i]});
  }
  await db.$transaction(async tx=>{if(newStudents.length){await tx.student.createMany({data:newStudents.map(({registerNumber,...s})=>s)});}if(newUsers.length)await tx.user.createMany({data:newUsers});if(references.length)await tx.externalReference.createMany({data:references,skipDuplicates:true});if(updates.length){const count=await tx.$executeRaw`UPDATE "User" u SET "password"=p.password,"loginIdentifier"=COALESCE(p."loginIdentifier",u."loginIdentifier"),"authVersion"=u."authVersion"+1,"updatedAt"=NOW() FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS p(id text,password text,"loginIdentifier" text) WHERE u.id=p.id AND u.role='STUDENT'`;if(count!==updates.length)throw Error('Account changed during provisioning');}},{timeout:120000});created+=newUsers.length;reset+=updates.length;console.log(JSON.stringify({phase:'accounts',completed:Math.min(offset+50,plan.length),total:plan.length}));
 }
 const resolve=identityIndex(targets.map(t=>t.student),targets.flatMap(t=>[t.row.roll_number,t.row.provider_roll_number].map(externalId=>({externalId,internalId:t.student.id}))));const candidates=rows.map(row=>mapRecord('READINESS',{...row,roll_number:row.provider_roll_number},resolve,fetchedAt));let inserted=0;
 for(let offset=0;offset<candidates.length;offset+=100){const chunk=candidates.slice(offset,offset+100);const result=await db.readinessAssessment.createMany({skipDuplicates:true,data:chunk.map(c=>({studentId:c.student.id,sourceResultId:c.sourceResultId,sourceBatchId:`roll-provision:${fetchedAt.toISOString()}`,readinessScore:c.score,verificationStatus:c.verificationStatus,parameterScores:c.parameters,assessedAt:c.assessedAt}))});inserted+=result.count;}
 console.log(JSON.stringify({mode:'applied',...summary,accountsCreated:created,passwordsReset:reset,scoresInserted:inserted,scoreDuplicates:candidates.length-inserted,selectionRecalculated:false,allocationsChanged:false,backup}));
}
if(require.main===module)main().catch(e=>{console.error(e.code?`Provisioning stopped (${e.code}); committed batches retained for safe retry`:e.message);process.exitCode=1;}).finally(()=>db.$disconnect());
