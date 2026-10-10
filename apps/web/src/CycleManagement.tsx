import React, { useEffect, useState } from 'react';
import { API, apiFetch } from './api';
import './selection-rules.css';

type Cycle = { id:string; code:string; name:string; status:string; academicPeriod:string; _count:{studentCycleStatuses:number}; cycleConfig:null|{hopeCount:number;pepCount:number;activeWeightVersion:null|{weights:Array<{parameterLabel:string;weight:number;maxRawScore:number}>};activeEligibilityRule:null|{description:string|null;rules:unknown}} };
type Options = {cycles:Cycle[];batches:Array<{id:string;batchIdentifier:string;academicYear:string;department:{name:string};_count:{students:number}}>};
type Student = {id:string;studentId:string;name:string;registerNumber:string|null;user:null|{loginIdentifier:string|null}};
async function request<T>(path:string,body?:unknown):Promise<T>{
  const response=await apiFetch(`${API}/cycle-management${path}`,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw new Error(Array.isArray(result.message)?result.message.join(', '):result.message??'Cycle request failed');return result;
}
export function CycleManagement({onActivated}:{onActivated:()=>Promise<void>}) {
  const [options,setOptions]=useState<Options>({cycles:[],batches:[]});
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
  const [form,setForm]=useState({code:'',name:'',academicPeriod:'2026–2027',startDate:'',endDate:'',hopeCount:0,pepCount:0,templateCycleId:'',readinessMinimum:0,cohort:'BATCH',batchId:'',copyPreferences:false});
  const [selected,setSelected]=useState<Record<string,Student>>({});
  const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1),[directory,setDirectory]=useState<{total:number;students:Student[]}>({total:0,students:[]});
  const [loading,setLoading]=useState(true),[studentsLoading,setStudentsLoading]=useState(false);
  async function load(){setOptions(await request<Options>('/options'));}
  useEffect(()=>{let live=true;request<Options>('/options').then(o=>live&&setOptions(o)).catch(e=>live&&setError(e.message)).finally(()=>live&&setLoading(false));return()=>{live=false;};},[]);
  useEffect(()=>{if(form.cohort!=='SELECTED')return;let live=true;setStudentsLoading(true);request<{total:number;students:Student[]}>(`/students?q=${encodeURIComponent(search)}&page=${page}`).then(d=>live&&setDirectory(d)).catch(e=>live&&setError(e.message)).finally(()=>live&&setStudentsLoading(false));return()=>{live=false;};},[form.cohort,search,page]);
  const template=options.cycles.find(c=>c.id===form.templateCycleId);
  function chooseTemplate(id:string){const t=options.cycles.find(c=>c.id===id);setForm(f=>({...f,templateCycleId:id,copyPreferences:false,hopeCount:t?.cycleConfig?.hopeCount??f.hopeCount,pepCount:t?.cycleConfig?.pepCount??f.pepCount,cohort:!id&&f.cohort==='CYCLE'?'BATCH':f.cohort}));}
  async function create(event:React.FormEvent){event.preventDefault();setBusy(true);setError('');setNotice('');try{
    const result=await request<{name:string;enrolled:number;preferencesCopied:number}>('',{...form,templateCycleId:form.templateCycleId||undefined,batchId:form.cohort==='BATCH'?form.batchId:undefined,studentIds:form.cohort==='SELECTED'?Object.keys(selected):undefined});
    setNotice(`Draft “${result.name}” created: ${result.enrolled} students enrolled, ${result.preferencesCopied} preferences copied. No selection results changed. Review it below before activation.`);await load();setForm(f=>({...f,code:'',name:''}));
  }catch(e){setError(e instanceof Error?e.message:'Could not create cycle');}finally{setBusy(false);}}
  async function activate(cycle:Cycle){
    const others=options.cycles.filter(c=>c.status==='ACTIVE'&&c.id!==cycle.id);
    const message=`Activate “${cycle.name}” with ${cycle._count.studentCycleStatuses} students?\n\n${others.length?`This archives the currently active cycle(s): ${others.map(c=>c.name).join(', ')}. Their stored results are preserved.\n\n`:''}This changes the portal’s current selection cycle but does not run selection.`;
    if(!window.confirm(message))return;setBusy(true);setError('');try{await request(`/${cycle.id}/activate`,{archiveOtherActive:others.length>0});await load();await onActivated();setNotice(`“${cycle.name}” is active. Add custom rules under Selection Rules, then run selection from Selection Overview.`);}catch(e){setError(e instanceof Error?e.message:'Activation failed');}finally{setBusy(false);}
  }
  return <section className="selectionRules" id="cycle-management">
    <header><p className="eyebrow">ADMINISTRATION</p><h1>Selection Cycles</h1><p>Create a separate selection round using existing students and assessments.</p></header>
    <div className="governanceBanner"><p>Creation is draft-only and does not change current results or passwords. Activation requires confirmation before archiving an existing active cycle. Synthetic live-demo students are excluded from enrollment.</p></div>
    {error&&<p className="portalError" role="alert">{error}</p>}{notice&&<p className="portalNotice" role="status">{notice}</p>}
    {loading?<p role="status">Loading cycle settings…</p>:<>
    <form className="portalCard ruleEditor" onSubmit={e=>void create(e)}><h2>Create a cycle</h2><fieldset disabled={busy}>
      <div className="ruleFormGrid">
        <label>Cycle code<input required pattern="[A-Z0-9][A-Z0-9_-]{2,63}" maxLength={64} placeholder="SECOND-YEAR-OCT-2026" value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase()})}/></label>
        <label>Cycle name<input required maxLength={120} placeholder="Second Year HOPE / PEP — October" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
        <label>Academic period<input required maxLength={80} value={form.academicPeriod} onChange={e=>setForm({...form,academicPeriod:e.target.value})}/></label>
        <label>Start date<input type="date" required value={form.startDate} onChange={e=>setForm({...form,startDate:e.target.value})}/></label>
        <label>End date<input type="date" required min={form.startDate} value={form.endDate} onChange={e=>setForm({...form,endDate:e.target.value})}/></label>
        <label>Scoring and baseline<select value={form.templateCycleId} onChange={e=>chooseTemplate(e.target.value)}><option value="">New: verified readiness score</option>{options.cycles.filter(c=>c.cycleConfig?.activeWeightVersion?.weights.length&&c.cycleConfig.activeEligibilityRule).map(c=><option key={c.id} value={c.id}>Copy from {c.name}</option>)}</select></label>
        <label>HOPE seats<input type="number" required min={0} max={100000} step={1} value={form.hopeCount} onChange={e=>setForm({...form,hopeCount:e.target.valueAsNumber})}/></label>
        <label>PEP seats<input type="number" required min={0} max={100000} step={1} value={form.pepCount} onChange={e=>setForm({...form,pepCount:e.target.valueAsNumber})}/></label>
        {!template&&<label>Minimum verified readiness / 250<input type="number" required min={0} max={250} step={1} value={form.readinessMinimum} onChange={e=>setForm({...form,readinessMinimum:e.target.valueAsNumber})}/></label>}
        <label>Students to enroll<select value={form.cohort} onChange={e=>setForm({...form,cohort:e.target.value})}><option value="BATCH">One department / batch</option><option value="ALL">All active non-synthetic students</option>{template&&<option value="CYCLE">Students from the source cycle</option>}<option value="SELECTED">Choose individual students</option></select></label>
        {form.cohort==='BATCH'&&<label>Department / batch<select required value={form.batchId} onChange={e=>setForm({...form,batchId:e.target.value})}><option value="">Choose a batch</option>{options.batches.map(b=><option key={b.id} value={b.id}>{b.department.name} · {b.batchIdentifier} · {b._count.students} students</option>)}</select></label>}
      </div>
      {template?<div className="ruleBaseline"><h3>Copied configuration</h3>{template.cycleConfig?.activeWeightVersion?.weights.map((w,i)=><p key={i}>{w.parameterLabel}: weight {w.weight}, maximum raw score {w.maxRawScore}</p>)}<p>{template.cycleConfig?.activeEligibilityRule?.description}</p><details><summary>Baseline conditions</summary><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(template.cycleConfig?.activeEligibilityRule?.rules,null,2)}</pre></details><label><input type="checkbox" checked={form.copyPreferences} onChange={e=>setForm({...form,copyPreferences:e.target.checked})}/> Copy recorded domain preferences for enrolled students</label><p>Custom policies such as “v1” are not copied. Create them for the new cycle under Selection Rules.</p></div>:<p className="portalMuted">Readiness setup: verified total / 250 contributes 100% of the composite score. Missing or unverified readiness fails eligibility. This is an explicit new baseline, not the college’s previous criteria.</p>}
      {form.cohort==='SELECTED'&&<section><h3>Choose students · {Object.keys(selected).length} selected</h3><div className="portalActions"><input aria-label="Search enrollment students" placeholder="Name, roll or register number" value={query} onChange={e=>setQuery(e.target.value)}/><button type="button" className="ghost" onClick={()=>{setPage(1);setSearch(query.trim());}}>Search</button><button type="button" className="ghost" onClick={()=>setSelected({})}>Clear selection</button></div>{studentsLoading?<p>Loading students…</p>:<div className="tableScroll"><table><thead><tr><th>Enroll</th><th>Student</th><th>Roll / register</th></tr></thead><tbody>{directory.students.map(s=><tr key={s.id}><td><input aria-label={`Enroll ${s.name}`} type="checkbox" checked={!!selected[s.id]} onChange={e=>setSelected(previous=>{const next={...previous};if(e.target.checked)next[s.id]=s;else delete next[s.id];return next;})}/></td><td>{s.name}</td><td>{s.user?.loginIdentifier??s.registerNumber??s.studentId}</td></tr>)}</tbody></table></div>}<div className="portalActions"><button className="ghost" type="button" disabled={page===1||studentsLoading} onClick={()=>setPage(page-1)}>Previous</button><span>Page {page} · {directory.total} students</span><button className="ghost" type="button" disabled={page*25>=directory.total||studentsLoading} onClick={()=>setPage(page+1)}>Next</button></div><p>{Object.values(selected).map(s=>s.user?.loginIdentifier??s.studentId).join(', ')}</p></section>}
      <p className="portalMuted">Students retain their accounts and scores. Allocation still requires domain preferences and available batches. Creation does not copy classifications, allocations or freeze history.</p>
      <button type="submit" disabled={busy||(form.cohort==='SELECTED'&&!Object.keys(selected).length)}>{busy?'Working…':'Create draft cycle'}</button>
    </fieldset></form>
    <section className="portalCard"><h2>Cycle history</h2>{options.cycles.map(c=><article className="ruleVersion" key={c.id}><div><h3>{c.name}</h3><p>{c.code} · {c.academicPeriod} · {c._count.studentCycleStatuses} students</p><p>HOPE: {c.cycleConfig?.hopeCount??'Not configured'} · PEP: {c.cycleConfig?.pepCount??'Not configured'}</p><small>Cycle ID: {c.id}</small></div><div><span className={`pill ${c.status==='ACTIVE'?'approved':'neutral'}`}>{c.status}</span>{c.status==='DRAFT'&&c.academicPeriod!=='DEMO'&&<button disabled={busy} onClick={()=>void activate(c)}>Activate cycle</button>}</div></article>)}</section>
    </>}
  </section>;
}
