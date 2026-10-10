import React, { useEffect, useState } from 'react';
import { API, apiFetch } from './api';
import { SelectionRules } from './SelectionRules';
import type { CurrentUser } from './Portals';

type Row = {studentId:string;name:string;coding:number;aptitude:number;attendance:number;totalScore:number|null;rank:number|null;baselineEligible:boolean|null;baselineFailures:unknown;program:string;customEligibility:unknown;evaluatedAt:string|null};
type Status = {cycle:{id:string;name:string};students:Row[]};
async function request<T>(path:string,method='GET'):Promise<T>{const r=await apiFetch(`${API}${path}`,{method});const b=await r.json();if(!r.ok)throw new Error(b.message??'Demo request failed');return b;}
function failures(value:unknown):string[]{
  if(Array.isArray(value))return value.flatMap(failures);
  if(!value||typeof value!=='object')return [];
  const v=value as Record<string,unknown>;
  if(v.passed!==true&&typeof v.message==='string'&&(v.passed===false||typeof v.ruleId==='string'))return [v.message];
  return Object.entries(v).filter(([key])=>key==='results'||key==='hope'||key==='pep').flatMap(([,child])=>failures(child));
}

export function SelectionDemo({user}:{user:CurrentUser}) {
  const [cycle,setCycle]=useState('');
  const [data,setData]=useState<Status|null>(null);
  const [previous,setPrevious]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [seconds,setSeconds]=useState(0);
  const [cycles,setCycles]=useState<Array<{id:string;name:string}>>([]);
  useEffect(()=>{let alive=true;request<{cycles:Array<{id:string;code:string;name:string}>}>('/selection-rules/options').then(o=>{if(!alive)return;const demos=o.cycles.filter(c=>c.code==='LIVE-RULES-DEMO-20261009');setCycles(demos);setCycle(demos[0]?.id??'');if(!demos.length)setNotice('Synthetic demo setup has not been provisioned yet.');}).catch(e=>alive&&setNotice(e.message));return()=>{alive=false;};},[]);
  useEffect(()=>{let alive=true;setData(null);setPrevious({});if(cycle)request<Status>(`/selection-pipeline/demo/${cycle}`).then(d=>alive&&setData(d)).catch(e=>alive&&setNotice(e.message));return()=>{alive=false;};},[cycle]);
  useEffect(()=>{if(!busy)return;setSeconds(0);const timer=window.setInterval(()=>setSeconds(s=>s+1),1000);return()=>window.clearInterval(timer);},[busy]);
  async function run(){if(!cycle||busy)return;setBusy(true);setNotice('Running the real scoring → eligibility → ranking → classification pipeline on six synthetic students…');setPrevious(Object.fromEntries((data?.students??[]).map(s=>[s.studentId,s.program])));try{const result=await request<{selected:number;waitlisted:number;ineligible:number}>(`/selection-pipeline/demo/${cycle}/run`,'POST');setData(await request<Status>(`/selection-pipeline/demo/${cycle}`));setNotice(`Completed: ${result.selected} selected, ${result.waitlisted} waitlisted, ${result.ineligible} not eligible. Results are saved in the database.`);}catch(e){setNotice(e instanceof Error?e.message:'Demo run failed');}finally{setBusy(false);}}
  return <section className="selectionRules">
    <header><p className="eyebrow">ISOLATED LIVE EXECUTION</p><h1>Selection Rules Demo</h1><p>Six synthetic students only. Uses the actual backend selection pipeline—not simulated browser results. The college’s active cycle is unchanged.</p></header>
    <label>Demo selection cycle<select aria-label="Demo selection cycle" disabled={busy} value={cycle} onChange={e=>setCycle(e.target.value)}>{cycles.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <div className="portalCard"><h2>Run → change a rule → rerun</h2><p>Baseline: coding ≥ 50 AND attendance ≥ 75%. Score: 60% coding + 40% aptitude. Capacity: 2 HOPE + 2 PEP.</p><p>First run: 4 selected, 1 waitlisted, 1 not eligible. Then save and activate a <b>College-wide / Both HOPE and PEP / Coding score ≥ 80</b> rule below and rerun: 2 selected, 4 not eligible. Copy that rule to a new draft with threshold 60, activate and rerun: 4 selected, 2 not eligible.</p><button disabled={busy||!cycle||!data} onClick={()=>void run()}>{busy?`Running demo selection… ${seconds}s`:'Run demo selection'}</button><p role="status">{notice}</p></div>
    {data&&<div className="portalCard"><h2>Saved results · {data.students.length} synthetic students</h2><div className="tableScroll"><table><thead><tr><th>Student / register</th><th>Coding</th><th>Aptitude</th><th>Attendance</th><th>Weighted score</th><th>Rank</th><th>Result / change</th><th>Why</th></tr></thead><tbody>{data.students.map(s=>{const reasons=[...new Set([...failures(s.baselineFailures),...failures(s.customEligibility)])];return <tr key={s.studentId}><td>{s.name}<small className="tableMeta">{s.studentId}</small></td><td>{s.coding}</td><td>{s.aptitude}</td><td>{s.attendance}%</td><td>{s.totalScore??'Not run'}</td><td>{s.rank??'—'}</td><td>{s.program.replaceAll('_',' ')}{previous[s.studentId]&&previous[s.studentId]!==s.program&&<small className="tableMeta">{previous[s.studentId]} → {s.program}</small>}</td><td>{reasons.length?reasons.join('; '):s.program==='WAITLIST'?'Eligible, but the four seats are filled':s.program==='NOT_RUN'?'Run the demo pipeline':s.program==='HOPE'||s.program==='PEP'?'Passed applicable rules and received a seat':'Review active rules'}{s.evaluatedAt&&<small className="tableMeta">Evaluated {new Date(s.evaluatedAt).toLocaleTimeString()}</small>}</td></tr>;})}</tbody></table></div></div>}
    {cycle&&<fieldset disabled={busy} style={{border:0,padding:0}}><SelectionRules user={user} fixedCycleId={cycle}/></fieldset>}
  </section>;
}
