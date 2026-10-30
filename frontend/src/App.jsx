import {createContext,useContext,useState} from 'react';import {NavLink,Route,Routes,Navigate} from 'react-router-dom';
import {api,isMock} from './api.js';import {useData,State} from './ui.jsx';
import Dashboard from './pages/Dashboard.jsx';import Events from './pages/Events.jsx';import Timeline from './pages/Timeline.jsx';import Graph from './pages/Graph.jsx';import Assistant from './pages/Assistant.jsx';import Documents from './pages/Documents.jsx';
const Ctx=createContext();export const useProject=()=>useContext(Ctx);
const nav=[['/','Projects'],['/documents','Documents'],['/events','Events'],['/timeline','Timeline'],['/graph','Knowledge Graph'],['/assistant','AI Assistant']];
export default function App(){const ps=useData(api.projects,[]);const[pid,setPid]=useState(null);const[open,setOpen]=useState(false);
return<State s={ps} empty="No projects yet."><div className="flex min-h-screen flex-col md:flex-row">
<header className="flex items-center justify-between border-b border-line bg-ink p-3 text-white md:hidden"><b>ProjectMind AI</b><button onClick={()=>setOpen(!open)} aria-expanded={open}>Menu</button></header>
<nav className={`${open?'block':'hidden'} w-full shrink-0 bg-ink p-5 text-slate-200 md:block md:w-60`}><p className="mb-6 hidden text-lg font-bold text-white md:block">ProjectMind AI</p>
<select className="mb-6 w-full rounded bg-slate-700 p-2 text-sm" aria-label="Project" value={pid||ps.data?.[0]?.id||''} onChange={e=>setPid(e.target.value)}>{ps.data?.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
<ul className="space-y-1">{nav.map(([to,l])=><li key={to}><NavLink to={to} end={to==='/'} onClick={()=>setOpen(false)} className={({isActive})=>`block rounded px-3 py-2 text-sm ${isActive?'bg-pine text-white':'hover:bg-slate-700'}`}>{l}</NavLink></li>)}</ul></nav>
<main className="min-w-0 flex-1">{isMock&&<div className="bg-amber-100 px-4 py-1 text-xs text-amber-900">Showing built-in mock data. Set VITE_API_BASE_URL to connect the API.</div>}
<Ctx.Provider value={pid||ps.data?.[0]?.id}><Routes><Route path="/" element={<Dashboard/>}/><Route path="/documents" element={<Documents/>}/><Route path="/events" element={<Events/>}/><Route path="/timeline" element={<Timeline/>}/><Route path="/graph" element={<Graph/>}/><Route path="/assistant" element={<Assistant/>}/><Route path="*" element={<Navigate to="/"/>}/></Routes></Ctx.Provider></main></div></State>;}
