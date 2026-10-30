import {useState} from 'react';import {api} from '../api.js';import {Evidence} from '../ui.jsx';import {useProject} from '../App.jsx';
export default function Assistant(){const p=useProject();const[q,setQ]=useState('');const[asOf,setAsOf]=useState('');const[r,setR]=useState(null);const[busy,setBusy]=useState(false);const[err,setErr]=useState('');const[sel,setSel]=useState(null);
const go=async e=>{e.preventDefault();if(!q.trim())return;setBusy(true);setErr('');setR(null);try{setR(await api.ask(p,q,asOf));}catch(x){setErr(x.message);}setBusy(false);};
const cite=id=>r.citations.find(c=>c.id===id);
return<div className="max-w-3xl p-6"><h1 className="mb-4 text-2xl font-bold">Historical assistant</h1>
<form onSubmit={go} className="mb-6 flex flex-wrap gap-2"><input className="min-w-0 flex-1 rounded border border-line p-3" placeholder="Why was dark mode postponed?" value={q} onChange={e=>setQ(e.target.value)} aria-label="Question"/><input type="date" aria-label="As-of date" className="rounded border border-line p-3" value={asOf} onChange={e=>setAsOf(e.target.value)}/><button disabled={busy} className="rounded bg-pine px-4 text-white disabled:opacity-50">{busy?'Asking…':'Ask'}</button></form>
{err&&<p className="rounded bg-rose-50 p-3 text-rose-900" role="alert">Could not get an answer. {err}</p>}
{!r&&!err&&!busy&&<p className="text-slate-600">Ask how a feature changed over time. Answers cite the original records.</p>}
{r&&(!r.sufficient?<div className="rounded border border-amber-300 bg-amber-50 p-4"><b>Not enough evidence to answer.</b>{r.limitations?.map(l=><p key={l} className="text-sm">{l}</p>)}</div>:<div className="space-y-5">
<section className="rounded border border-line bg-white p-4"><h2 className="mb-1 font-semibold">Answer</h2><p>{r.answer}</p></section>
<section><h2 className="mb-1 font-semibold">Claims</h2><ul className="space-y-1">{r.claims.map((c,i)=><li key={i} className="text-sm">{c.text} {c.cites.map(id=><button key={id} className="ml-1 rounded bg-mist px-1.5 font-mono text-xs underline" onClick={()=>setSel(cite(id))}>[{id}]</button>)}</li>)}</ul></section>
{!!r.conflicts?.length&&<section className="rounded border border-orange-300 bg-orange-50 p-4"><h2 className="font-semibold">Conflicts</h2>{r.conflicts.map(c=><p key={c} className="text-sm">{c}</p>)}</section>}
{!!r.limitations?.length&&<section><h2 className="font-semibold">Limitations</h2>{r.limitations.map(c=><p key={c} className="text-sm text-slate-600">{c}</p>)}</section>}</div>)}
<Evidence ev={sel} onClose={()=>setSel(null)}/></div>;}
