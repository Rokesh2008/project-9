import React, { useEffect, useState } from 'react';
import { API, apiFetch } from './api';
import type { CurrentUser } from './Portals';
import './selection-rules.css';

type Rule = {id:string;field:string;operator:string;value?:number};
type Policy = {id:string;name:string;domainId:string|null;program:string;isActive:boolean;canEdit:boolean;createdAt:string;rules:{logic:'AND'|'OR';rules:Rule[]}};
type Options = {cycles:Array<{id:string;name:string;status:string}>;domains:Array<{id:string;code:string;name:string}>;fields:Array<{key:string;label:string;max:number|null}>};
type Evaluation = {isEligible:boolean;results:Array<{ruleId:string;message:string;passed:boolean}>};
type Preview = {student:{name:string;registerNumber:string};proposed:Evaluation;college:Evaluation|null;notice:string};
async function request<T>(path:string,body?:unknown):Promise<T>{
  const response=await apiFetch(`${API}/selection-rules${path}`,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok)throw new Error(Array.isArray(data.message)?data.message.join('; '):data.message??'Request failed');
  return data;
}
const newRule=():Rule=>({id:crypto.randomUUID(),field:'cgpa',operator:'GTE',value:7});

export function SelectionRules({user,fixedCycleId}:{user:CurrentUser;fixedCycleId?:string}){
  const [options,setOptions]=useState<Options>({cycles:[],domains:[],fields:[]});
  const [cycle,setCycle]=useState('');
  const [domain,setDomain]=useState(user.role==='ADMIN'?'':user.facultyDomainId??'');
  const [program,setProgram]=useState('BOTH');
  const [name,setName]=useState('');
  const [logic,setLogic]=useState<'AND'|'OR'>('AND');
  const [rules,setRules]=useState<Rule[]>([newRule()]);
  const [policies,setPolicies]=useState<Policy[]>([]);
  const [baseline,setBaseline]=useState<Array<{description:string|null;rules:{logic:string;rules:Rule[]}}>>([]);
  const [register,setRegister]=useState('');
  const [preview,setPreview]=useState<Preview|null>(null);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const frozen=options.cycles.find(c=>c.id===cycle)?.status==='FROZEN';
  const editable=!!cycle&&!frozen&&(user.role==='ADMIN'||user.role==='PEP_STAFF'&&!!user.facultyDomainId);
  useEffect(()=>{let alive=true;request<Options>('/options').then(data=>{if(alive){setOptions(data);setCycle(fixedCycleId??data.cycles.find(c=>c.status==='ACTIVE')?.id??data.cycles[0]?.id??'');}}).catch(e=>alive&&setNotice(e.message));return()=>{alive=false;};},[fixedCycleId]);
  async function load(id=cycle){const data=await request<{policies:Policy[];baseline:typeof baseline}>(`/cycles/${id}`);setPolicies(data.policies);setBaseline(data.baseline);}
  useEffect(()=>{let alive=true;setPreview(null);setPolicies([]);if(cycle)request<{policies:Policy[];baseline:typeof baseline}>(`/cycles/${cycle}`).then(data=>{if(alive){setPolicies(data.policies);setBaseline(data.baseline);}}).catch(e=>alive&&setNotice(e.message));return()=>{alive=false;};},[cycle]);
  function changeRule(id:string,patch:Partial<Rule>){setRules(rows=>rows.map(r=>r.id===id?{...r,...patch}:r));setPreview(null);}
  function copy(policy:Policy){setDomain(policy.domainId??'');setProgram(policy.program);setName(`${policy.name} — revised`);setLogic(policy.rules.logic);setRules(policy.rules.rules.map(r=>({...r,id:crypto.randomUUID()})));setPreview(null);setNotice('Copied into a new draft. The existing version has not changed.');}
  const payload=()=>({selectionCycleId:cycle,domainId:domain||null,program,name:name.trim(),logic,rules:rules.map(r=>r.operator==='EXISTS'?{id:r.id,field:r.field,operator:r.operator}:r)});
  async function act(action:()=>Promise<void>){setBusy(true);setNotice('');try{await action();}catch(e){setNotice(e instanceof Error?e.message:'Request failed');}finally{setBusy(false);}}
  async function save(){await request('',payload());await load();setNotice('Draft saved. Activate this version below when ready. No selection results have changed.');}
  async function toggle(p:Policy){if(!window.confirm(`${p.isActive?'Deactivate':'Activate'} “${p.name}”? This changes future rule checks but does not automatically rerun selection or change frozen results.`))return;await act(async()=>{await request(`/${p.id}/${p.isActive?'deactivate':'activate'}`,{});await load();setNotice('Rule status updated. Admins must rerun official selection to refresh programme results; domain rules are checked on new placements and approvals.');});}
  return <section id="faculty-selection-rules" className="selectionRules">
    <header><p className="eyebrow">SELECTION GOVERNANCE</p><h1>Custom Selection Rules</h1><p>Define transparent criteria, preview a student, then activate a version.</p></header>
    <div className="governanceBanner"><p><b>{user.role==='ADMIN'?'College-wide and domain authority':'Assigned-domain authority'}</b><br />College-wide rules add PEP/HOPE requirements to the existing baseline. Domain rules govern placement in that domain only. Rank order and capacity limits still apply. Missing or unverified readiness data does not pass a score requirement.</p></div>
    {notice&&<p className="portalNotice" role="status">{notice}</p>}
    <label className="ruleCycle">Selection cycle<select disabled={!!fixedCycleId} value={cycle} onChange={e=>setCycle(e.target.value)}>{options.cycles.filter(c=>!fixedCycleId||c.id===fixedCycleId).map(c=><option key={c.id} value={c.id}>{c.name} · {c.status}</option>)}</select></label>
    {frozen&&<p className="portalNotice">This cycle is frozen. Rules and official results are read-only.</p>}
    <details className="portalCard ruleBaseline"><summary>Existing college baseline ({baseline.length} active version)</summary>{baseline.map((b,i)=><div key={i}><p>{b.description??'Baseline eligibility'} · {b.rules.logic}</p>{b.rules.rules.map(r=><p key={r.id}>{r.field} {r.operator} {String(r.value??'required')}</p>)}</div>)}{!baseline.length&&<p>No baseline has been configured for this cycle.</p>}</details>
    <form className="portalCard ruleEditor" onSubmit={e=>{e.preventDefault();void act(save);}}>
      <h2>Create a rule version</h2><p className="portalMuted">All active policies are combined. Within this version choose whether all or any conditions must pass.</p>
      <fieldset disabled={busy||!editable}>
        <div className="ruleFormGrid">
          <label>Version name<input required maxLength={120} value={name} placeholder="Example: Data science entry criteria" onChange={e=>{setName(e.target.value);setPreview(null);}} /></label>
          <label>Scope<select value={domain} onChange={e=>{setDomain(e.target.value);setPreview(null);}}>{user.role==='ADMIN'&&<option value="">College-wide</option>}{options.domains.filter(d=>user.role==='ADMIN'||d.id===user.facultyDomainId).map(d=><option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}</select></label>
          <label>Programme<select value={program} onChange={e=>{setProgram(e.target.value);setPreview(null);}}><option value="BOTH">Both HOPE and PEP</option><option value="HOPE">HOPE only</option><option value="PEP">PEP only</option></select></label>
          <label>Condition logic<select value={logic} onChange={e=>{setLogic(e.target.value as 'AND'|'OR');setPreview(null);}}><option value="AND">All conditions must pass (AND)</option><option value="OR">At least one must pass (OR)</option></select></label>
        </div>
        {rules.map((r,index)=><div className="ruleCondition" key={r.id}><span>{index+1}</span><label>Student field<select value={r.field} onChange={e=>changeRule(r.id,{field:e.target.value,value:0})}>{options.fields.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}</select></label><label>Comparison<select value={r.operator} onChange={e=>changeRule(r.id,{operator:e.target.value})}>{[['GTE','At least (≥)'],['LTE','At most (≤)'],['GT','Greater than (>)'],['LT','Less than (<)'],['EQ','Equal to (=)'],['NEQ','Not equal to (≠)'],['EXISTS','Data is available']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>{r.operator!=='EXISTS'&&<label>Threshold<input required type="number" min={0} max={options.fields.find(f=>f.key===r.field)?.max??undefined} step={r.field==='certificateCount'?1:'any'} value={r.value??0} onChange={e=>changeRule(r.id,{value:e.target.valueAsNumber})}/></label>}<button type="button" className="ghost" disabled={rules.length===1} aria-label={`Remove condition ${index+1}`} onClick={()=>{setRules(rules.filter(row=>row.id!==r.id));setPreview(null);}}>Remove</button></div>)}
        <div className="portalActions"><button type="button" className="ghost" disabled={rules.length>=30} onClick={()=>{setRules([...rules,newRule()]);setPreview(null);}}>Add condition</button><button type="submit">Save draft</button></div>
        <div className="rulePreview"><label>Preview using register number<input value={register} placeholder="DEMO2026004" onChange={e=>{setRegister(e.target.value);setPreview(null);}} /></label><button type="button" className="ghost" disabled={!name.trim()||!register.trim()} onClick={()=>void act(async()=>{setPreview(await request<Preview>('/preview',{...payload(),registerNumber:register.trim()}));})}>Preview only</button></div>
      </fieldset>
      {preview&&<div className="rulePreviewResult"><h3>{preview.student.name} · {preview.student.registerNumber}</h3><p><b>Proposed version: {preview.proposed.isEligible?'PASS':'DOES NOT PASS'}</b> · Existing baseline: {preview.college?(preview.college.isEligible?'PASS':'DOES NOT PASS'):'Not configured'}</p>{preview.proposed.results.map(r=><p key={r.ruleId}>{r.passed?'✓':'✗'} {r.message}</p>)}<p className="portalMuted">{preview.notice}</p></div>}
    </form>
    <section className="portalCard"><h2>Rule version history</h2><p className="portalMuted">Activation replaces the active version for the same cycle, scope and programme. Versions for “Both” and a specific programme both apply.</p>{!policies.length&&<p>No custom versions yet. Existing eligibility rules remain unchanged.</p>}{policies.map(p=><article className="ruleVersion" key={p.id}><div><h3>{p.name}</h3><p>{p.domainId?(options.domains.find(d=>d.id===p.domainId)?.name??p.domainId):'College-wide'} · {p.program} · {p.rules.logic} · {new Date(p.createdAt).toLocaleString()}</p>{p.rules.rules.map(r=><small key={r.id}>{options.fields.find(f=>f.key===r.field)?.label??r.field} {r.operator} {r.operator==='EXISTS'?'':String(r.value)}<br /></small>)}</div><div><span className={`pill ${p.isActive?'approved':'neutral'}`}>{p.isActive?'Active':'Inactive / Draft'}</span>{p.canEdit&&!frozen&&<div className="portalActions"><button disabled={busy} className="ghost" onClick={()=>copy(p)}>Copy to new draft</button><button disabled={busy} onClick={()=>void toggle(p)}>{p.isActive?'Deactivate':'Activate'}</button></div>}{!p.canEdit&&<small>Read only · outside your authority</small>}</div></article>)}</section>
  </section>;
}
