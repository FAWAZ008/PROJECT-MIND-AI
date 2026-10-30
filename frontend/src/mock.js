// Mock JSON shaped like the assumed contract. Replace once Akash/Athish publish final fields.
const s=(doc,quote)=>({doc,quote});
export const projects=[{id:'p1',name:'Sample project'}];
export const documents=[{id:'d1',name:'issue-142.md',type:'GITHUB_ISSUE',status:'PROCESSED'},{id:'d2',name:'meeting-2025-03-04.txt',type:'MEETING_NOTES',status:'PROCESSED'},{id:'d3',name:'prd-v2.pdf',type:'PRD',status:'PROCESSED'}];
export const events=[
{id:'e1',feature:'Dark mode',type:'PROPOSAL',status:'PROPOSED',eventDate:'2025-01-12',ingestedAt:'2025-06-01',confidence:0.93,review:'CONFIRMED',source:s('issue-142.md','Add a dark theme to the settings page.')},
{id:'e2',feature:'Dark mode',type:'APPROVAL',status:'APPROVED',eventDate:'2025-03-04',ingestedAt:'2025-06-01',confidence:0.81,review:'PENDING',source:s('meeting-2025-03-04.txt','Team agreed to ship dark mode in the next release.')},
{id:'e3',feature:'Dark mode',type:'IMPLEMENTATION',status:'IMPLEMENTED',eventDate:'2025-04-20',ingestedAt:'2025-06-02',confidence:0.55,review:'PENDING',source:s('pr-231.md','Implements theme toggle; closes #142.')},
{id:'e4',feature:'Dark mode',type:'DEPRECATION',status:'CONFLICT',eventDate:'2025-05-30',ingestedAt:'2025-06-02',confidence:0.7,review:'PENDING',source:s('prd-v2.pdf','Dark mode is postponed until the design system lands.')}];
export const edges=[{id:'x1',from:'e1',to:'e2',type:'DECIDED_BY'},{id:'x2',from:'e3',to:'e1',type:'INTRODUCES'},{id:'x3',from:'e4',to:'e3',type:'CONTRADICTS'}];
export const ask=(q)=>({sufficient:true,answer:'Mock answer: dark mode was proposed, approved and implemented, but a later PRD says it was postponed.',claims:[{text:'Approved on 2025-03-04',cites:['c1']},{text:'PRD later marks it postponed',cites:['c2']}],citations:[{id:'c1',doc:'meeting-2025-03-04.txt',quote:events[1].source.quote},{id:'c2',doc:'prd-v2.pdf',quote:events[3].source.quote}],limitations:['Mock data only.'],conflicts:['Implementation PR vs PRD postponement']});
