import { useState, useEffect } from 'react';
import Spinner from '@atlaskit/spinner';
import Lozenge from '@atlaskit/lozenge';

interface Analytics {
  total_issues: number;
  done_issues: number;
  total_sessions: number;
  by_scope: Record<string, number>;
  most_reopened: Array<{id: string; title: string; reopen_count: number}>;
  avg_sessions: number;
}

export default function AnalyticsDashboard() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/workspace/analytics')
      .then(r => r.json())
      .then((body: Analytics & {ok: boolean}) => { if (body.ok) setData(body); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',flex:1}}>
      <Spinner size="medium"/>
    </div>
  );

  if (!data) return (
    <div style={{padding:32,color:'var(--ds-text-subtle)',textAlign:'center'}}>
      Analytics unavailable — initialize a workspace first.
    </div>
  );

  const completion_pct = data.total_issues > 0 ? Math.round(data.done_issues / data.total_issues * 100) : 0;
  const scopes = ['nano','small','medium','large','research','unset'];

  return (
    <div style={{flex:1,overflowY:'auto',padding:'24px 32px',maxWidth:900}}>
      <h1 style={{fontSize:22,fontWeight:700,color:'var(--ds-text)',marginBottom:24}}>
        Workspace Analytics
      </h1>

      {/* Top metric cards */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:32}}>
        {[
          {label:'Total Issues', value: data.total_issues},
          {label:'Completed', value: `${data.done_issues} (${completion_pct}%)`},
          {label:'Total Sessions', value: data.total_sessions},
          {label:'Avg Sessions / Ticket', value: data.avg_sessions},
        ].map(card => (
          <div key={card.label} style={{
            background:'var(--ds-surface-raised)',border:'1px solid var(--ds-border)',
            borderRadius:8,padding:'16px 20px',
          }}>
            <div style={{fontSize:11,color:'var(--ds-text-subtlest)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:6}}>{card.label}</div>
            <div style={{fontSize:28,fontWeight:700,color:'var(--ds-text)'}}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Scope distribution */}
      <div style={{background:'var(--ds-surface-raised)',border:'1px solid var(--ds-border)',borderRadius:8,padding:20,marginBottom:24}}>
        <h2 style={{fontSize:15,fontWeight:600,color:'var(--ds-text)',marginBottom:16}}>Issues by Scope</h2>
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {scopes.filter(s => data.by_scope[s]).map(scope => {
            const count = data.by_scope[scope] ?? 0;
            const pct = data.total_issues > 0 ? count / data.total_issues * 100 : 0;
            return (
              <div key={scope} style={{display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:72,fontSize:12,color:'var(--ds-text-subtle)',textAlign:'right'}}>{scope}</div>
                <div style={{flex:1,height:20,background:'var(--ds-surface-sunken)',borderRadius:4,overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${pct}%`,background:'var(--ds-background-brand-bold)',borderRadius:4,transition:'width 0.4s'}}/>
                </div>
                <div style={{width:32,fontSize:12,color:'var(--ds-text-subtlest)'}}>{count}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Most reopened */}
      {data.most_reopened.length > 0 && (
        <div style={{background:'var(--ds-surface-raised)',border:'1px solid var(--ds-border)',borderRadius:8,padding:20}}>
          <h2 style={{fontSize:15,fontWeight:600,color:'var(--ds-text)',marginBottom:16}}>Most Reopened Tickets</h2>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {data.most_reopened.map(ticket => (
              <div key={ticket.id} style={{display:'flex',alignItems:'center',gap:12,padding:'8px 0',borderBottom:'1px solid var(--ds-border)'}}>
                <span style={{fontFamily:'monospace',fontSize:12,color:'var(--ds-link)',minWidth:60}}>{ticket.id}</span>
                <span style={{flex:1,fontSize:14,color:'var(--ds-text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ticket.title}</span>
                <Lozenge appearance="removed">&#8617; {ticket.reopen_count}&times;</Lozenge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
