"""Static CSS and JavaScript assets for the design-pattern workbench."""

from __future__ import annotations


CSS = r"""
:root{
  --bg:#0d1117;
  --bg-2:#111821;
  --panel:#151c27;
  --panel-2:#0f151d;
  --ink:#e6edf3;
  --muted:#8b949e;
  --line:#303846;
  --line-strong:#657183;
  --accent:#00d9ff;
  --accent-2:#ff6b35;
  --gain:#7ee787;
  --loss:#ff7b72;
  --shadow:rgba(0,0,0,.48);
}
*{box-sizing:border-box}
html{background:var(--bg);color-scheme:dark}
body{
  margin:0;
  min-height:100vh;
  background:
    radial-gradient(circle at 72% 2%,rgba(0,217,255,.16),transparent 32rem),
    radial-gradient(circle at 8% 18%,rgba(255,107,53,.12),transparent 27rem),
    linear-gradient(180deg,#0d1117 0%,#0a0e14 100%);
  color:var(--ink);
  font-family:"Inter Tight",sans-serif;
}
.grid-backdrop{
  position:fixed;
  inset:0;
  z-index:-1;
  pointer-events:none;
  opacity:.36;
  background-image:
    linear-gradient(rgba(230,237,243,.06) 1px,transparent 1px),
    linear-gradient(90deg,rgba(230,237,243,.06) 1px,transparent 1px),
    linear-gradient(rgba(0,217,255,.06),transparent 38%);
  background-size:32px 32px,32px 32px,100% 100%;
  mask-image:linear-gradient(180deg,#000 0%,rgba(0,0,0,.78) 45%,transparent 100%);
}
body:before{
  content:"";
  position:fixed;
  inset:0;
  pointer-events:none;
  z-index:10;
  opacity:.09;
  background:repeating-linear-gradient(180deg,transparent 0,transparent 3px,rgba(230,237,243,.9) 4px);
  mix-blend-mode:overlay;
}
button,select,input,textarea{font:inherit}
button,select,input,textarea,.card,.panel,.stat,.insight,.detail,.lab,.mini{border-radius:0}
button{
  border:1px solid var(--accent);
  background:#061923;
  color:var(--ink);
  padding:9px 12px;
  cursor:pointer;
  text-transform:uppercase;
  letter-spacing:.04em;
  font-family:"JetBrains Mono",monospace;
  font-size:12px;
}
button:hover{background:var(--accent);color:#071016;box-shadow:0 0 0 1px #071016 inset,0 0 26px rgba(0,217,255,.22)}
button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--accent-2);outline-offset:2px}
kbd{font-family:"JetBrains Mono",monospace;color:var(--accent-2);font-size:10px;margin-left:6px}
.shell{min-height:100vh;display:grid;grid-template-columns:318px minmax(0,1fr)}
.side{
  position:sticky;
  top:0;
  height:100vh;
  overflow:auto;
  border-right:1px solid var(--line-strong);
  background:linear-gradient(180deg,rgba(13,17,23,.94),rgba(9,13,18,.98));
  padding:22px;
  box-shadow:16px 0 60px var(--shadow);
}
.brand{border-bottom:1px solid var(--line-strong);padding-bottom:18px}
.kicker,.eyebrow,.terminal-line,.meta,.stat span,.insight span{
  font-family:"JetBrains Mono",monospace;
  text-transform:uppercase;
  letter-spacing:.09em;
  font-size:11px;
}
.kicker,.eyebrow{color:var(--accent)}
.terminal-line{color:var(--muted);margin:10px 0 0;font-size:11px;text-transform:none}
h1,h2,h3{margin:0}
h1{
  font-family:"Space Mono",monospace;
  font-size:30px;
  line-height:.98;
  margin:8px 0 0;
  letter-spacing:-.06em;
}
.tabs{display:grid;gap:6px;margin:22px 0}
.tab{
  width:100%;
  display:grid;
  grid-template-columns:minmax(0,1fr) auto;
  gap:10px;
  background:rgba(21,28,39,.72);
  color:var(--ink);
  border-color:var(--line);
  text-align:left;
}
.tab.active{background:linear-gradient(90deg,rgba(0,217,255,.18),rgba(0,217,255,.04));border-color:var(--accent);color:var(--accent)}
.panel{border:1px solid var(--line);background:rgba(15,21,29,.86);padding:14px;margin:16px 0}
.panel h2{font-size:13px;margin-bottom:12px;font-family:"JetBrains Mono",monospace;color:var(--ink);text-transform:uppercase;letter-spacing:.08em}
.panel label{display:grid;gap:6px;margin:10px 0;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
select,input,textarea{
  width:100%;
  border:1px solid var(--line);
  background:#090d13;
  color:var(--ink);
  padding:10px;
}
select{appearance:auto}
.compact{font-family:"JetBrains Mono",monospace;font-size:12px;color:var(--muted);line-height:1.55}
.main{padding:22px 26px 34px;min-width:0}
.status-strip{
  display:flex;
  flex-wrap:wrap;
  gap:0;
  border:1px solid var(--line);
  background:#080c12;
  margin-bottom:18px;
  font-family:"JetBrains Mono",monospace;
  font-size:11px;
  color:var(--muted);
  text-transform:uppercase;
}
.status-strip span{padding:8px 12px;border-right:1px solid var(--line)}
.status-strip span:first-child{color:var(--gain)}
.hero{
  display:grid;
  grid-template-columns:minmax(0,1fr) minmax(260px,auto);
  gap:20px;
  border:1px solid var(--line-strong);
  background:
    linear-gradient(135deg,rgba(0,217,255,.10),transparent 28%),
    linear-gradient(180deg,rgba(21,28,39,.92),rgba(13,17,23,.94));
  padding:22px;
  position:relative;
  overflow:hidden;
}
.hero:after{
  content:"";
  position:absolute;
  right:-120px;
  bottom:-100px;
  width:420px;
  height:220px;
  border:1px solid rgba(0,217,255,.24);
  transform:skewX(-28deg);
  background:repeating-linear-gradient(90deg,rgba(0,217,255,.18) 0 2px,transparent 2px 16px);
}
.hero h2{
  position:relative;
  z-index:1;
  max-width:980px;
  font-family:"Space Mono",monospace;
  font-size:clamp(36px,5vw,76px);
  line-height:.92;
  letter-spacing:-.08em;
  text-transform:uppercase;
}
.stats{position:relative;z-index:1;display:grid;grid-template-columns:repeat(2,112px);gap:8px}
.stat{background:#090d13;border:1px solid var(--line);padding:12px;min-height:80px}
.stat strong{display:block;font-family:"Space Mono",monospace;font-size:30px;line-height:1;color:var(--accent)}
.stat span{display:block;margin-top:8px;color:var(--muted);font-size:10px}
.searchbar{
  display:grid;
  grid-template-columns:auto minmax(0,1fr) auto;
  gap:0;
  margin:18px 0;
  border:1px solid var(--line-strong);
  background:#060a0f;
}
.searchbar .prompt{
  display:grid;
  place-items:center;
  width:42px;
  color:var(--accent-2);
  font-family:"JetBrains Mono",monospace;
  border-right:1px solid var(--line);
}
.searchbar input{font-size:16px;padding:15px;border:0;font-family:"JetBrains Mono",monospace;background:transparent}
.searchbar button{border-width:0 0 0 1px}
.workspace{display:grid;grid-template-columns:minmax(0,1.28fr) minmax(360px,.72fr);gap:18px}
.toolbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-family:"JetBrains Mono",monospace;color:var(--muted)}
.toolbar strong{color:var(--ink);text-transform:uppercase;letter-spacing:.06em}
.toolbar div{display:flex;gap:6px;flex-wrap:wrap}
.toolbar button{background:#0e141c;border-color:var(--line)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(285px,1fr));gap:10px}
.card{
  background:linear-gradient(180deg,rgba(21,28,39,.94),rgba(11,16,23,.96));
  border:1px solid var(--line);
  padding:14px;
  min-height:188px;
  display:flex;
  flex-direction:column;
  gap:10px;
  cursor:pointer;
  position:relative;
  overflow:hidden;
}
.card:before{
  content:"";
  position:absolute;
  left:0;
  top:0;
  bottom:0;
  width:3px;
  background:var(--line);
}
.card:hover{border-color:var(--accent);transform:translateY(-1px);box-shadow:0 0 0 1px rgba(0,217,255,.16),0 16px 42px rgba(0,0,0,.34)}
.card:hover:before,.card.selected:before{background:var(--accent)}
.card.selected{outline:1px solid var(--accent-2);border-color:var(--accent-2)}
.card h3,.mini strong{font-family:"Space Mono",monospace;letter-spacing:-.05em;line-height:1.08}
.meta{font-size:10px;color:var(--muted)}
.summary{font-size:14px;line-height:1.45;color:#c9d1d9}
.pills{display:flex;flex-wrap:wrap;gap:5px;margin-top:auto}
.pill{
  font-family:"JetBrains Mono",monospace;
  font-size:10px;
  border:1px solid var(--line);
  padding:3px 6px;
  background:#070b10;
  color:#c9d1d9;
}
.detail{
  position:sticky;
  top:18px;
  align-self:start;
  background:linear-gradient(180deg,rgba(15,21,29,.96),rgba(7,11,16,.96));
  border:1px solid var(--line-strong);
  padding:18px;
  max-height:calc(100vh - 36px);
  overflow:auto;
}
.detail h2{font-family:"Space Mono",monospace;font-size:30px;line-height:1;letter-spacing:-.07em;text-transform:uppercase}
.detail section{margin:16px 0;border-top:1px solid var(--line);padding-top:12px}
.detail h3{font-family:"JetBrains Mono",monospace;font-size:12px;color:var(--accent);text-transform:uppercase;letter-spacing:.08em}
.detail p,.detail li{color:#c9d1d9;line-height:1.5}
.detail ul{padding-left:18px}
.muted{color:var(--muted);font-family:"JetBrains Mono",monospace}
.insights{display:grid;grid-template-columns:repeat(auto-fit,minmax(178px,1fr));gap:10px;margin:0 0 18px}
.insight{border:1px solid var(--line);background:#0c1219;padding:12px;min-height:68px}
.insight strong{display:block;font-family:"Space Mono",monospace;font-size:26px;color:var(--accent-2);line-height:1}
.insight span{display:block;margin-top:8px;color:var(--muted)}
.studio{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-top:18px}
.lab{
  background:linear-gradient(180deg,rgba(14,20,28,.98),rgba(8,12,18,.98));
  color:var(--ink);
  border:1px solid var(--line);
  padding:14px;
  min-height:280px;
  box-shadow:0 18px 45px rgba(0,0,0,.24);
}
.scenario,.scanner,.brief,.context-pack,.simulator,.migration{grid-column:span 2}
.graph-lab{grid-column:span 4}
.matrix-lab{grid-column:span 2}
.lab-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;border-bottom:1px solid var(--line);padding-bottom:10px}
.lab-head span{font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--accent)}
.lab button{background:#08131a;border-color:var(--line)}
.lab textarea{min-height:92px;background:#060a0f;color:var(--ink);border-color:var(--line);margin-bottom:10px;font-family:"JetBrains Mono",monospace;font-size:12px;line-height:1.45}
.lab pre{white-space:pre-wrap;max-height:360px;overflow:auto;font-family:"JetBrains Mono",monospace;font-size:12px;background:#060a0f;padding:12px;border:1px solid var(--line);color:#dce7f0}
.recommendations,.scan-output,.matrix{display:grid;gap:8px;max-height:430px;overflow:auto}
.mini{border:1px solid var(--line);background:#0b1017;padding:10px}
.mini:hover{border-color:var(--accent)}
.mini p{margin:7px 0 0;color:#b9c4cf;font-size:13px;line-height:1.4}
.mini .meta{color:var(--muted)}
.path{display:grid;grid-template-columns:92px minmax(0,1fr);gap:8px;border-top:1px solid var(--line);padding-top:8px;margin-top:8px}
.path span{font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--accent-2);word-break:break-word}
.matrix-table{width:100%;border-collapse:collapse;font-family:"JetBrains Mono",monospace;font-size:11px}
.matrix-table th,.matrix-table td{border-bottom:1px solid var(--line);padding:7px 6px;text-align:left;vertical-align:top}
.matrix-table th{color:var(--accent);text-transform:uppercase;letter-spacing:.08em}
.bar{height:5px;background:linear-gradient(90deg,var(--accent),var(--gain));display:block;margin-top:4px}
#graph{width:100%;height:360px;background:#05080c;border:1px solid var(--line)}
.node{fill:var(--bg-2);stroke:var(--accent);stroke-width:1.3}
.edge{stroke:var(--accent);stroke-width:1;opacity:.34}
.label{font:10px "JetBrains Mono",monospace;fill:#dce7f0}
@keyframes consoleIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.hero,.searchbar,.insight,.workspace,.lab{animation:consoleIn .32s cubic-bezier(.22,1,.36,1) both}
@media (prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}
@media (max-width:1180px){.studio{grid-template-columns:repeat(2,minmax(0,1fr))}.scenario,.scanner,.brief,.context-pack,.simulator,.migration,.graph-lab,.matrix-lab{grid-column:span 1}.workspace{grid-template-columns:1fr}}
@media (max-width:980px){.shell{grid-template-columns:1fr}.side{position:relative;height:auto}.workspace,.studio,.hero{grid-template-columns:1fr}.scenario,.scanner,.brief,.context-pack,.simulator,.migration,.graph-lab,.matrix-lab{grid-column:span 1}.stats{grid-template-columns:repeat(3,1fr)}.status-strip span{width:50%}}
"""


JS = r"""
const state={all:[],entries:[],facets:{},stats:{},kind:'',selected:null,compare:new Set(),matrix:null};
const $=id=>document.getElementById(id);
const api=path=>fetch(path).then(r=>r.json());
const postJson=(path,payload)=>fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(r=>r.json());
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function optionList(el,items,label){el.innerHTML=`<option value="">${label}</option>`+items.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');}
function pill(items,limit=5){return (items||[]).slice(0,limit).map(x=>`<span class="pill">${esc(x)}</span>`).join('');}
function bySlug(slug){return state.all.find(e=>e.slug===slug);}
function summary(entry){return entry?.summary||entry?.intent||entry?.symptom||entry?.goal||entry?.outputContract||'';}
function mini(entry){return `<div class="mini" data-slug="${esc(entry.slug)}"><div class="meta">${esc(entry.kind)} / ${esc(entry.domain)}</div><strong>${esc(entry.name)}</strong><p>${esc(summary(entry))}</p></div>`}
function renderInsights(){const topKinds=['pattern','playbook','smell','framework','recipe','language']; $('insights').innerHTML=topKinds.map(k=>`<div class="insight"><strong>${state.stats[k]||0}</strong><span>${k}</span></div>`).join('');}
function card(entry){const compared=state.compare.has(entry.slug); return `<article class="card ${state.selected?.slug===entry.slug?'selected':''}" data-slug="${esc(entry.slug)}">
  <div class="meta">${esc(entry.kind)} / ${esc(entry.domain)} ${entry.score?'/ score '+entry.score:''}</div>
  <h3>${esc(entry.name)}</h3>
  <p class="summary">${esc(summary(entry))}</p>
  <div class="pills">${pill([...(entry.qualityAttributes||[]),...(entry.patterns||[]),...(entry.smells||[])])}</div>
  ${compared?'<div class="meta">in compare tray</div>':''}
</article>`}
function renderPaths(paths){if(!paths?.length)return ''; return paths.map(path=>`<div class="path"><span>${esc(path.from)}</span><div>
  <strong>${esc(path.name)}</strong>
  <p>${esc(path.summary)}</p>
  <div class="pills">${pill([...(path.patterns||[]),...(path.playbooks||[]),...(path.recipes||[]),...(path.frameworks||[])],8)}</div>
</div></div>`).join('');}
function detail(entry){ if(!entry){$('detail').innerHTML='<p class="muted">No entry selected.</p>'; return;}
 const sections=[['Intent',entry.intent],['Symptom',entry.symptom],['Why It Matters',entry.whyItMatters],['Goal',entry.goal],['Output Contract',entry.outputContract]];
 const lists=[['When To Use',entry.whenToUse],['Avoid When',entry.avoidWhen],['Forces',entry.forces],['Tradeoffs',entry.tradeoffNotes],['Failure Modes',entry.failureModeNotes],['Testing',entry.testing||entry.tests],['Observability',entry.observability],['Implementation Notes',entry.implementationNotes],['Best For',entry.bestFor],['Pattern Mapping',entry.patternMapping],['Steps',entry.steps],['Verification',entry.verification],['Checks',entry.checks],['Criteria',entry.criteriaNotes],['Anti-Patterns',entry.antiPatterns],['Scale',entry.scale]];
 $('detail').innerHTML=`<div class="meta">${esc(entry.kind)} / ${esc(entry.domain)}</div><h2>${esc(entry.name)}</h2>`+
 sections.filter(x=>x[1]).map(([h,v])=>`<section><h3>${h}</h3><p>${esc(v)}</p></section>`).join('')+
 lists.filter(x=>x[1]?.length).map(([h,items])=>`<section><h3>${h}</h3><ul>${items.map(i=>`<li>${esc(i)}</li>`).join('')}</ul></section>`).join('')+
 `<section><h3>Tags</h3><div class="pills">${pill([...(entry.groups||[]),...(entry.languages||[]),...(entry.patterns||[]),...(entry.smells||[])],12)}</div></section>`+
 `<button type="button" onclick="toggleCompare('${esc(entry.slug)}')">Toggle Compare</button> <button type="button" onclick="briefFrom('${esc(entry.slug)}')">Brief</button><section id="neighborhood"></section>`;
 loadNeighborhood(entry.slug);
}
function params(){const p=new URLSearchParams(); const q=$('query').value.trim(); if(q)p.set('q',q); if(state.kind)p.set('kind',state.kind);
 for(const [id,key] of [['domainFilter','domain'],['groupFilter','group'],['languageFilter','language'],['qualityFilter','quality']]){const v=$(id).value;if(v)p.set(key,v)} return p;}
async function loadResults(){const data=await api('/api/search?'+params().toString()); state.entries=data.entries; $('resultCount').textContent=`${data.entries.length} entries`; $('cards').innerHTML=data.entries.map(card).join(''); document.querySelectorAll('.card').forEach(c=>c.onclick=()=>select(c.dataset.slug)); tabs();}
async function select(slug){state.selected=bySlug(slug)||state.entries.find(e=>e.slug===slug)||state.selected; detail(state.selected); await loadResults(); drawGraph();}
function toggleCompare(slug){state.compare.has(slug)?state.compare.delete(slug):state.compare.add(slug); loadResults(); compare();}
async function compare(){const slugs=[...state.compare]; if(!slugs.length){$('adrOutput').textContent=''; return;} const data=await api('/api/compare?slugs='+encodeURIComponent(slugs.join(','))); $('adrOutput').textContent=JSON.stringify(data.entries.map(e=>({slug:e.slug,name:e.name,kind:e.kind,tradeoffs:e.tradeoffNotes||e.avoidWhen||e.checks||[]})),null,2);}
function tabs(){const counts={}; state.all.forEach(e=>counts[e.kind]=(counts[e.kind]||0)+1); const kinds=['','pattern','playbook','smell','framework','recipe','scorecard','language']; $('kindTabs').innerHTML=kinds.map(k=>`<button class="tab ${state.kind===k?'active':''}" data-kind="${k}"><span>${k||'all'}</span><span>${k?counts[k]||0:state.all.length}</span></button>`).join(''); document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{state.kind=t.dataset.kind; loadResults();});}
async function runScenario(){const p=new URLSearchParams(); p.set('q',$('scenarioPrompt').value); const lang=$('languageFilter').value; if(lang)p.set('language',lang); p.set('risk',$('riskFilter').value); const data=await api('/api/recommend?'+p.toString()); $('recommendations').innerHTML=(data.recommendations||[]).slice(0,5).map(entry=>`<div class="mini" data-slug="${esc(entry.slug)}"><div class="meta">${esc(entry.kind)} / score ${entry.score}</div><strong>${esc(entry.name)}</strong><p>${esc(entry.summary)}</p><div class="pills">${pill(entry.matchedTerms||[],6)}</div></div>`).join('')+renderPaths(data.paths); document.querySelectorAll('#recommendations .mini[data-slug]').forEach(n=>n.onclick=()=>select(n.dataset.slug));}
async function scanText(){const data=await postJson('/api/scan-text',{text:$('scanText').value}); $('scanOutput').innerHTML=data.findings.length?data.findings.map(f=>`<div class="mini"><div class="meta">${esc(f.slug)} / line ${f.line}</div><strong>${esc(f.name)}</strong><p>${esc(f.evidence)}</p><div class="pills">${pill(f.patterns,8)}</div></div>`).join('')+renderPaths(data.paths):'<div class="mini"><strong>No smell match</strong><p>Keep the design small and reversible.</p></div>';}
async function loadNeighborhood(slug){const data=await api('/api/neighborhood/'+encodeURIComponent(slug)); const el=$('neighborhood'); if(!el||data.error)return; el.innerHTML=`<h3>Neighborhood</h3>${(data.related||[]).slice(0,6).map(e=>mini(e)).join('')}${renderPaths(data.paths)}`; el.querySelectorAll('.mini[data-slug]').forEach(n=>n.onclick=()=>select(n.dataset.slug));}
async function makeBrief(slug){const slugs=slug?[slug]:([...state.compare].length?[...state.compare]:(state.selected?[state.selected.slug]:[])); const p=new URLSearchParams(); p.set('slugs',slugs.join(',')); p.set('context',$('briefContext').value); const data=await api('/api/brief?'+p.toString()); $('briefOutput').textContent=data.markdown;}
function briefFrom(slug){makeBrief(slug);}
async function makeAdr(){const data=await api('/api/adr?q='+encodeURIComponent($('adrPrompt').value)); $('adrOutput').textContent=`# ADR: ${data.title}\n\nStatus: ${data.status}\n\n## Context\n${data.context}\n\n## Decision\n${data.decision}\n\n## Alternatives\n${(data.alternatives||[]).map(x=>'- '+x.name+' (`'+x.slug+'`)').join('\n')}\n\n## Consequences\n${data.consequences.map(x=>'- '+x).join('\n')}\n\n## Verification\n${data.verification.map(x=>'- '+x).join('\n')}`;}
async function makeContext(){const p=new URLSearchParams(); p.set('path',$('contextPath').value); p.set('q',$('contextQuery').value); const lang=$('languageFilter').value; if(lang)p.set('language',lang); const data=await api('/api/context?'+p.toString()); $('contextOutput').textContent=data.markdown||JSON.stringify(data,null,2);}
async function runSimulation(){const p=new URLSearchParams(); p.set('q',$('simulatePrompt').value); p.set('risk',$('riskFilter').value); const lang=$('languageFilter').value; if(lang)p.set('language',lang); const data=await api('/api/simulate?'+p.toString()); $('simulationOutput').textContent=data.markdown||JSON.stringify(data,null,2);}
async function makeMigration(){const p=new URLSearchParams(); p.set('from',$('migrationSource').value); p.set('to',$('migrationTarget').value); p.set('q',$('briefContext').value); const lang=$('languageFilter').value; if(lang)p.set('language',lang); const data=await api('/api/migrate?'+p.toString()); $('migrationOutput').textContent=data.markdown||JSON.stringify(data,null,2);}
async function askGraph(){const data=await api('/api/graph-query?q='+encodeURIComponent($('graphQuery').value)); $('graphAnswer').textContent=(data.answers||[]).map(x=>'- '+x).join('\n')||JSON.stringify(data,null,2);}
async function loadMatrix(){const data=await api('/api/matrix'); state.matrix=data; const maxLang=Math.max(...data.languages.map(x=>x.count),1); const maxQual=Math.max(...data.qualities.map(x=>x.count),1); $('matrix').innerHTML=`<table class="matrix-table"><thead><tr><th>Language</th><th>Patterns</th><th>Object</th><th>Integration</th></tr></thead><tbody>${data.languages.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.count}<span class="bar" style="width:${Math.round(x.count/maxLang*100)}%"></span></td><td>${x.objectDesign}</td><td>${x.integrationDesign}</td></tr>`).join('')}</tbody></table><table class="matrix-table"><thead><tr><th>Quality</th><th>Coverage</th></tr></thead><tbody>${data.qualities.slice(0,10).map(x=>`<tr><td>${esc(x.slug)}</td><td>${x.count}<span class="bar" style="width:${Math.round(x.count/maxQual*100)}%"></span></td></tr>`).join('')}</tbody></table>`;}
async function drawGraph(){const data=await api('/api/graph'); const svg=$('graph'); let nodeIds=new Set(); if(state.selected){nodeIds.add(state.selected.slug); data.edges.filter(e=>e.source===state.selected.slug||e.target===state.selected.slug).forEach(e=>{nodeIds.add(e.source);nodeIds.add(e.target);});}
 let nodes=(nodeIds.size?data.nodes.filter(n=>nodeIds.has(n.id)):data.nodes).slice(0,56); if(nodes.length<12)nodes=data.nodes.slice(0,42); const ids=new Set(nodes.map(n=>n.id)); const edges=data.edges.filter(e=>ids.has(e.source)&&ids.has(e.target)).slice(0,90); const pos={}; nodes.forEach((n,i)=>{const a=i/nodes.length*Math.PI*2; const ring=i%2?135:95; pos[n.id]=[450+310*Math.cos(a),180+ring*Math.sin(a)]}); svg.innerHTML=edges.map(e=>`<line class="edge" x1="${pos[e.source][0]}" y1="${pos[e.source][1]}" x2="${pos[e.target][0]}" y2="${pos[e.target][1]}"/>`).join('')+nodes.map(n=>`<circle class="node" cx="${pos[n.id][0]}" cy="${pos[n.id][1]}" r="${state.selected?.slug===n.id?8:5}"><title>${esc(n.label)}</title></circle><text class="label" x="${pos[n.id][0]+8}" y="${pos[n.id][1]+4}">${esc(n.id)}</text>`).join('');}
async function init(){const data=await api('/api/catalog'); state.facets=data.facets; state.stats=data.stats; state.all=data.entries; optionList($('domainFilter'),data.facets.domains,'All domains'); optionList($('groupFilter'),data.facets.groups,'All groups'); optionList($('languageFilter'),data.facets.languages,'All languages'); optionList($('qualityFilter'),data.facets.qualityAttributes,'All qualities');
 $('stats').innerHTML=Object.entries(data.stats).map(([k,v])=>`<div class="stat"><strong>${v}</strong><span>${k}</span></div>`).join(''); renderInsights(); const cov=await api('/api/coverage'); $('coverage').innerHTML=`Classic object patterns: ${cov.catalogObjectPatternCount}/${cov.classicObjectPatternCount}<br>Python coverage: ${cov.pythonSupported?'complete':'missing'}`;
 ['query','domainFilter','groupFilter','languageFilter','qualityFilter','riskFilter'].forEach(id=>$(id).addEventListener('input',()=>{loadResults(); runScenario();})); $('clearFilters').onclick=()=>{state.kind=''; ['query','domainFilter','groupFilter','languageFilter','qualityFilter'].forEach(id=>$(id).value=''); loadResults();};
 $('makeAdr').onclick=makeAdr; $('graphMode').onclick=drawGraph; $('compareMode').onclick=compare; $('adrMode').onclick=makeAdr; $('analyzeScenario').onclick=runScenario; $('scanTextButton').onclick=scanText; $('makeBrief').onclick=()=>makeBrief(); $('makeContext').onclick=makeContext; $('runSimulation').onclick=runSimulation; $('makeMigration').onclick=makeMigration; $('askGraph').onclick=askGraph; $('refreshMatrix').onclick=loadMatrix;
 await loadResults(); await runScenario(); await scanText(); await makeContext(); await runSimulation(); await makeMigration(); await askGraph(); await loadMatrix(); drawGraph();}
init();
"""
