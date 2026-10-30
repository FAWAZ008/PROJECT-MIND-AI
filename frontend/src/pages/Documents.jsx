import {api} from '../api.js';import {useData,State} from '../ui.jsx';import {useProject} from '../App.jsx';
export default function Documents(){const p=useProject();const s=useData(()=>api.documents(p),[p]);
return<div className="p-6"><h1 className="mb-4 text-2xl font-bold">Documents</h1><State s={s} empty="No documents uploaded yet."><ul className="divide-y divide-line rounded border border-line bg-white">{s.data?.map(d=><li key={d.id} className="flex justify-between p-3 text-sm"><span className="font-mono">{d.name}</span><span>{d.type} · {d.status}</span></li>)}</ul></State></div>;}
