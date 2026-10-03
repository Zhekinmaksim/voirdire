import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Caption, Film, Metal, Panel, Rule, Stage} from '../components/Chrome';
import {Brand} from '../components/Brand';
import {ramp, rise} from '../anim';
import {C, FILM, MONO, PAD} from '../theme';
import {BAR, ownFrames} from '../timing';
import release from '../release.json';

// The musical grid and original material system are preserved. All measured
// counts and live settlement facts come from the validated release snapshot.
const TIGHT = 100;
const FAMILIES = release.families;
const COLUMNS = [...FAMILIES.map(f => ({key:f.family, label:f.family.split('-')[0].toUpperCase()})), {key:'ABSTAIN', label:'ABSTAIN'}];
const CELL = 300, HEAD = 420, ROW = 132;

export const Title: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Stage span={ownFrames('title')} push={0.03}>
      <AbsoluteFill style={{padding:PAD, justifyContent:'center'}}>
        <Brand width={1280} style={rise(f,0.1,{bars:0.5})}/>
        <div style={{marginTop:34,fontSize:48,lineHeight:1.32,color:C.smoke,maxWidth:1380,...rise(f,0.65,{bars:0.5})}}>
          Bonded model claims. Behavioural evidence you can inspect.
        </div>
        <Caption style={{marginTop:44,fontSize:28,...rise(f,1.15,{bars:0.4})}}>
          built on GenLayer · Bradbury testnet
        </Caption>
      </AbsoluteFill>
    </Stage>
  );
};

const LINES = ['A model name is a claim.', 'A response is something you can observe.', 'A bond gives the declaration weight.'];
export const Problem: React.FC = () => {
  const f=useCurrentFrame();
  return (
    <Stage span={ownFrames('problem')}>
      <AbsoluteFill style={{padding:PAD,justifyContent:'center'}}>
        {LINES.map((line,i)=><div key={line} style={{fontSize:76,lineHeight:1.22,color:i===2?C.chalk:C.ash,maxWidth:1640,marginBottom:28,...rise(f,i*0.35,{bars:0.4})}}>{line}</div>)}
      </AbsoluteFill>
    </Stage>
  );
};

export const Routing: React.FC = () => {
  const f=useCurrentFrame();
  const nodes=[['claim','collector fixed'],['collector','signed response record'],['provider','pinned model route']];
  return (
    <Stage span={ownFrames('routing')}>
      <AbsoluteFill style={{padding:PAD,justifyContent:'center'}}>
        <div style={{fontSize:64,lineHeight:1.2,color:C.chalk,maxWidth:1560,...rise(f,0,{bars:0.4})}}>A trusted collector, fixed at registration.</div>
        <div style={{marginTop:60,display:'flex',alignItems:'center',gap:22}}>
          {nodes.map(([name,note],i)=><React.Fragment key={name}>
            {i>0?<Rule progress={ramp(f,0.4+i*0.3,0.4)} style={{width:76,flexShrink:0}} color={C.iron}/>:null}
            <Panel style={{padding:'30px 34px',flex:1,...rise(f,0.4+i*0.3,{bars:0.4})}}>
              <div style={{fontFamily:MONO,fontSize:34,color:C.chalk}}>{name}</div>
              <div style={{marginTop:16,fontSize:30,color:C.smoke,lineHeight:1.3}}>{note}</div>
            </Panel>
          </React.Fragment>)}
        </div>
        <div style={{marginTop:52,fontSize:42,lineHeight:1.35,color:C.ash,maxWidth:1560,...rise(f,1.3,{bars:0.4})}}>It signs the responses. It cannot prove the model weights.</div>
      </AbsoluteFill>
    </Stage>
  );
};

const STEPS=[['COMMIT','plan + nonce hashed on chain'],['COLLECT','pinned route, signed evidence'],['PUBLISH','attest first, then reveal'],['JUDGE','whole-profile decision']];
export const Commit: React.FC = () => {
  const f=useCurrentFrame();
  return (
    <Stage span={ownFrames('commit')}>
      <AbsoluteFill style={{padding:PAD,justifyContent:'center'}}>
        <div style={{fontSize:60,lineHeight:1.2,color:C.chalk,maxWidth:1560,...rise(f,0,{bars:0.4})}}>The plan is committed before responses are collected.</div>
        <div style={{marginTop:52,display:'flex',gap:20}}>
          {STEPS.map(([name,note],i)=><Panel key={name} style={{padding:'30px 28px',flex:1,...rise(f,0.4+i*0.3,{bars:0.4})}}>
            <div style={{fontFamily:MONO,fontSize:32,color:C.chalk}}>{name}</div>
            <div style={{marginTop:14,fontSize:28,color:C.smoke,lineHeight:1.35}}>{note}</div>
          </Panel>)}
        </div>
        <Caption style={{marginTop:40,fontSize:25,...rise(f,1.65,{bars:0.35})}}>frozen profile sha256 · {release.profile_hash.slice(0,32)}…</Caption>
        <div style={{marginTop:30,fontSize:36,lineHeight:1.3,color:C.smoke,maxWidth:1500,...rise(f,2,{bars:0.35})}}>Published probes are spent for that claim.</div>
      </AbsoluteFill>
    </Stage>
  );
};

const Grid: React.FC<{local:number; startBar:number; spectral:number}> = ({local,startBar,spectral}) => {
  const headers=ramp(local,startBar,0.3);
  return (
    <div>
      <div style={{display:'flex',opacity:headers}}>
        <div style={{width:HEAD,fontSize:26,color:C.smoke,paddingBottom:20}}>actual endpoint</div>
        {COLUMNS.map(c=><div key={c.key} style={{width:CELL,fontFamily:MONO,fontSize:28,color:C.chalk,padding:'0 0 20px 24px'}}>{c.label}</div>)}
      </div>
      <Rule progress={headers}/>
      {FAMILIES.map((family,r)=><div key={family.family}>
        <div style={{display:'flex',height:ROW,alignItems:'center'}}>
          <div style={{width:HEAD,opacity:headers,paddingRight:20}}>
            <div style={{fontSize:32,color:C.ash}}>{family.label}</div>
            <div style={{marginTop:10,fontFamily:MONO,fontSize:23,color:C.smoke}}>{family.provider} · {family.tag}</div>
          </div>
          {COLUMNS.map((column,c)=>{
            const value=(family.confusion as Record<string,number>)[column.key];
            const unresolved=column.key==='ABSTAIN';
            const matched=column.key===family.family;
            const appear=ramp(local,startBar+0.25+(r*4+c)*0.04,0.2);
            return <div key={column.key} style={{width:CELL,height:ROW,position:'relative',borderLeft:`1px solid ${C.graphite}`,opacity:appear,overflow:'hidden'}}>
              {matched?<div style={{position:'absolute',inset:0,opacity:0.2+0.8*value/100,background:'linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,0) 70%)'}}/>:null}
              {unresolved?<Film style={{opacity:spectral}}/>:null}
              <div style={{position:'relative',padding:'22px 24px'}}>
                <div style={{fontFamily:MONO,fontSize:44,letterSpacing:'-0.022em',color:unresolved&&spectral>0.5?'#0b0b0b':matched||unresolved?C.chalk:C.smoke}}>{value}</div>
                <div style={{marginTop:8,fontSize:25,color:unresolved&&spectral>0.5?'#242424':C.smoke}}>{unresolved?'unresolved':matched?'matched':'wrong family'}</div>
              </div>
            </div>;
          })}
        </div>
        <Rule progress={headers}/>
      </div>)}
    </div>
  );
};

const MatrixLayout: React.FC<{local:number;spectral:number;filled?:boolean;note:React.ReactNode}> = ({local,spectral,filled=false,note}) => (
  <AbsoluteFill style={{padding:TIGHT,justifyContent:'center'}}>
    <div style={{fontSize:54,color:C.chalk,marginBottom:40,lineHeight:1.2,...rise(filled?local+BAR*4:local,0,{bars:0.4})}}>Fresh responses. A frozen classifier.</div>
    <Grid local={filled?local+BAR*4:local} startBar={filled?0:0.3} spectral={spectral}/>
    <div style={{marginTop:34,fontSize:36,color:C.ash,lineHeight:1.32,...rise(local,filled?0.6:1.3,{bars:0.4})}}>{note}</div>
    <Caption style={{marginTop:20,fontSize:25,...rise(local,filled?1.05:1.65,{bars:0.3})}}>100 whole six-probe rounds per endpoint · counts, not probabilities</Caption>
  </AbsoluteFill>
);

export const Matrix: React.FC = () => {
  const f=useCurrentFrame();
  return <Stage span={ownFrames('matrix')} push={0.015}><MatrixLayout local={f} spectral={0} note={`${release.responses.toLocaleString('en-US')} new responses. ${release.rounds} rounds. Three pinned model/provider routes.`}/></Stage>;
};
export const Spectral: React.FC = () => {
  const f=useCurrentFrame();
  return <Stage span={ownFrames('spectral')} atmosphere={0.55} push={0.015}><MatrixLayout local={f} spectral={ramp(f,0.4,0.8)} filled note={`${release.abstentions} abstentions. Each remains unresolved and counts against correct/all.`}/></Stage>;
};

export const Statement: React.FC = () => {
  const f=useCurrentFrame();
  return (
    <Stage span={ownFrames('statement')} atmosphere={0.5}>
      <AbsoluteFill style={{padding:PAD,justifyContent:'center'}}>
        <div style={{fontSize:84,lineHeight:1.14,color:C.chalk,maxWidth:1620,...rise(f,0,{bars:0.35})}}>Zero observed wrong-family decisions.</div>
        <div style={{marginTop:36,fontSize:46,color:C.ash,maxWidth:1620,...rise(f,0.4,{bars:0.35})}}>Per-model 95% upper bound: {release.false_accusation_upper95_percent.toFixed(3)}%.</div>
        <div style={{marginTop:30,fontSize:34,color:C.smoke,lineHeight:1.35,maxWidth:1540,...rise(f,0.7,{bars:0.35})}}>Known routes only. Unknown models and future drift are not certified.</div>
      </AbsoluteFill>
    </Stage>
  );
};

const CONTROL_COPY={
  INCONSISTENT:{title:'GPT declared as Llama',note:'Both referees: admissible. Claim voided; pool credited.'},
  CONSISTENT:{title:'Truthful GPT, matched',note:'Stake returned. Bond released on closure.'},
  INCONCLUSIVE:{title:'Truthful GPT, abstained',note:'Stake returned. No confirmed round.'},
};
export const Finding: React.FC = () => {
  const f=useCurrentFrame();
  return (
    <Stage span={ownFrames('finding')}>
      <AbsoluteFill style={{padding:PAD,justifyContent:'center'}}>
        <div style={{fontSize:58,lineHeight:1.2,color:C.chalk,maxWidth:1620,...rise(f,0,{bars:0.4})}}>Three live controls. Three different outcomes.</div>
        <div style={{display:'flex',gap:24,marginTop:48}}>
          {release.controls.map((control,i)=>{
            const verdict=control.verdict as keyof typeof CONTROL_COPY;
            const copy=CONTROL_COPY[verdict];
            return <Panel key={verdict} style={{padding:'34px 30px',flex:1,minHeight:332,...rise(f,0.4+i*0.3,{bars:0.4})}}>
              <div style={{fontFamily:MONO,fontSize:31,color:C.chalk,...(verdict==='INCONCLUSIVE'?{backgroundImage:FILM,backgroundClip:'text',WebkitBackgroundClip:'text',color:'transparent'}:{})}}>{verdict}</div>
              <div style={{marginTop:26,fontSize:34,color:C.ash,lineHeight:1.3}}>{copy.title}</div>
              <div style={{marginTop:24,fontSize:29,color:C.smoke,lineHeight:1.38}}>{copy.note}</div>
            </Panel>;
          })}
        </div>
        <Caption style={{marginTop:32,fontSize:25,...rise(f,1.55,{bars:0.35})}}>Bradbury testnet · finalized controls</Caption>
      </AbsoluteFill>
    </Stage>
  );
};

export const Cost: React.FC = () => {
  const f=useCurrentFrame();
  return (
    <Stage span={ownFrames('cost')}>
      <AbsoluteFill style={{padding:PAD,justifyContent:'center'}}>
        <div style={{fontFamily:MONO,fontSize:150,letterSpacing:'-0.055em',color:C.chalk,...rise(f,0,{bars:0.3})}}>{release.withdrawal.amount_gen}<span style={{fontSize:82,marginLeft:32}}>GEN</span></div>
        <div style={{marginTop:28,fontSize:44,color:C.ash,maxWidth:1550,lineHeight:1.3,...rise(f,0.3,{bars:0.3})}}>Native withdrawal finalized. The exact amount reached the wallet.</div>
        <Caption style={{marginTop:30,fontSize:27,...rise(f,0.6,{bars:0.3})}}>testnet GEN · no real-money deployment</Caption>
      </AbsoluteFill>
    </Stage>
  );
};

const CLASSES=[['refusal_shape','refusal shape'],['repeat_stability','repeat stability'],['tokenizer_artifact','tokenizer artifact']];
const EXAMPLE=release.probes.find(p=>p.id==='stb-005')!;
export const Corpus: React.FC = () => {
  const f=useCurrentFrame();
  return (
    <Stage span={ownFrames('corpus')}>
      <AbsoluteFill style={{padding:PAD,justifyContent:'center'}}>
        <div style={{fontSize:60,color:C.chalk,lineHeight:1.2,...rise(f,0,{bars:0.4})}}>Six fixed probes. One examination per claim.</div>
        <div style={{display:'flex',gap:24,marginTop:44}}>
          {CLASSES.map(([cls,label],i)=><Panel key={cls} style={{padding:'30px 34px',flex:1,...rise(f,0.4+i*0.25,{bars:0.35})}}>
            <div style={{fontSize:27,color:C.smoke,marginBottom:18}}>{label}</div>
            {release.probes.filter(p=>p.class===cls).map(p=><div key={p.id} style={{fontFamily:MONO,fontSize:44,color:C.ash,marginTop:12}}>{p.id}</div>)}
          </Panel>)}
        </div>
        <div style={{marginTop:32,borderLeft:`1px solid ${C.iron}`,paddingLeft:24,fontSize:34,color:C.ash,lineHeight:1.35,maxWidth:1600,...rise(f,1.2,{bars:0.35})}}>“{EXAMPLE.carrier}”</div>
        <Caption style={{marginTop:32,fontSize:27,...rise(f,1.6,{bars:0.35})}}>Published probes are spent for that claim. No second independent round.</Caption>
      </AbsoluteFill>
    </Stage>
  );
};

const STATUS_ROWS=[['fresh confirmation','PASS · tested scope'],['Bradbury v3 contract','deployed'],['native withdrawal','finalized'],['working application',`${release.site}/app/`]];
export const Status: React.FC = () => {
  const f=useCurrentFrame();
  return (
    <Stage span={ownFrames('status')} atmosphere={0.7}>
      <AbsoluteFill style={{padding:PAD,justifyContent:'center'}}>
        <div style={{fontSize:60,color:C.chalk,...rise(f,0,{bars:0.4})}}>Live, within stated limits.</div>
        <div style={{marginTop:44,maxWidth:1660}}>
          {STATUS_ROWS.map(([label,status],i)=><div key={label} style={rise(f,0.35+i*0.25,{bars:0.35})}>
            <Rule progress={ramp(f,0.35+i*0.25,0.3)}/>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'22px 0',gap:40}}>
              <span style={{fontSize:40,color:C.ash}}>{label}</span>
              <span style={{fontFamily:MONO,fontSize:32,color:C.chalk,whiteSpace:'nowrap'}}>{status}</span>
            </div>
          </div>)}
          <Rule progress={ramp(f,1.2,0.3)}/>
        </div>
        <Caption style={{marginTop:36,fontSize:27,...rise(f,1.4,{bars:0.35})}}>Observed {release.observed_date} · trusted collector required · Bradbury testnet</Caption>
      </AbsoluteFill>
    </Stage>
  );
};

export const Close: React.FC = () => {
  const f=useCurrentFrame();
  return (
    <Stage span={ownFrames('close')} atmosphere={0.85} push={0.025}>
      <AbsoluteFill style={{padding:PAD,justifyContent:'center'}}>
        <Brand width={680} style={rise(f,0.1,{bars:0.4})}/>
        <div style={{marginTop:34,fontSize:112,lineHeight:1.06,letterSpacing:'-0.03em',...rise(f,0.35,{bars:0.4})}}><Metal sweep={[BAR*0.5,BAR*1.8]}>Not proof. Testimony.</Metal></div>
        <div style={{marginTop:32,fontSize:44,color:C.smoke,lineHeight:1.38,maxWidth:1510,...rise(f,0.65,{bars:0.4})}}>Observable behaviour, bounded claims, and a bond. Built on GenLayer Bradbury.</div>
        <Caption style={{marginTop:38,fontSize:46,color:C.ash,...rise(f,1.1,{bars:0.35})}}>{release.site}</Caption>
      </AbsoluteFill>
    </Stage>
  );
};
