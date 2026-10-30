import * as m from './mock.js';
const BASE=import.meta.env.VITE_API_BASE_URL;export const isMock=!BASE;
const j=async(p,o={})=>{const r=await fetch(BASE+p,{headers:{'Content-Type':'application/json'},...o});if(!r.ok)throw new Error(`Request failed: ${r.status} ${r.statusText}`);return r.json();};
const mock=(v)=>new Promise(r=>setTimeout(()=>r(structuredClone(v)),250));
// Endpoint paths are assumptions until the API contract is confirmed.
export const api={
projects:()=>isMock?mock(m.projects):j('/projects'),
documents:p=>isMock?mock(m.documents):j(`/projects/${p}/documents`),
events:p=>isMock?mock(m.events):j(`/projects/${p}/events`),
edges:p=>isMock?mock(m.edges):j(`/projects/${p}/edges`),
review:(id,b)=>isMock?mock({...m.events.find(e=>e.id===id),...b}):j(`/events/${id}/review`,{method:'PATCH',body:JSON.stringify(b)}),
ask:(p,question,asOf)=>isMock?mock(m.ask(question)):j(`/projects/${p}/ask`,{method:'POST',body:JSON.stringify({question,asOf:asOf||null})})};
