import {useEffect,useState,useCallback} from 'react';
const C={PROPOSED:'bg-sky-100 text-sky-900',APPROVED:'bg-emerald-100 text-emerald-900',REJECTED:'bg-rose-100 text-rose-900',IMPLEMENTED:'bg-teal-100 text-teal-900',UNKNOWN:'bg-slate-200 text-slate-800',CONFLICT:'bg-orange-200 text-orange-950','NEEDS REVIEW':'bg-amber-100 text-amber-900'};
export const Badge=({v})=><span className={`rounded px-2 py-0.5 text-xs font-semibold ${C[v]||C.UNKNOWN}`}>{v}</span>;
export const needsReview=e=>e.review==='PENDING'||e.confidence<0.6;
export function useData(fn,deps){const[s,set]=useState({loading:true});const run=useCallback(()=>{set({loading:true});fn().then(data=>set({data}),error=>set({error:error.message}));},deps);useEffect(run,[run]);return{...s,reload:run};}
export const State=({s,empty,children})=>s.loading?<p className="p-6 text-slate-600" role="status">Loading…</p>:s.error?<div className="m-6 rounded border border-rose-300 bg-rose-50 p-4 text-rose-900">Could not load data. {s.error} <button className="ml-2 underline" onClick={s.reload}>Retry</button></div>:(Array.isArray(s.data)&&!s.data.length)?<p className="p-6 text-slate-600">{empty}</p>:children;
export const Evidence=({ev,onClose})=>ev?<aside className="fixed inset-y-0 right-0 z-20 w-full max-w-md overflow-auto border-l border-line bg-white p-6 shadow-xl" aria-label="Source evidence"><button onClick={onClose} className="float-right text-sm underline">Close</button>
<h3 className="text-lg font-semibold">{ev.feature||'Evidence'}</h3>{ev.status&&<div className="mt-2 flex gap-2"><Badge v={ev.status}/>{needsReview(ev)&&<Badge v="NEEDS REVIEW"/>}</div>}
<dl className="mt-4 space-y-3 text-sm"><div><dt className="text-slate-500">Source</dt><dd className="font-mono">{ev.source?.doc||ev.doc}</dd></div>
{ev.eventDate&&<div><dt className="text-slate-500">Event date / ingested</dt><dd>{ev.eventDate} / {ev.ingestedAt}</dd></div>}
{ev.confidence!=null&&<div><dt className="text-slate-500">Confidence</dt><dd>{Math.round(ev.confidence*100)}%</dd></div>}
<div><dt className="text-slate-500">Exact quote</dt><dd><blockquote className="border-l-4 border-pine bg-mist p-3 font-mono text-[13px]">{ev.source?.quote||ev.quote}</blockquote></dd></div></dl></aside>:null;
