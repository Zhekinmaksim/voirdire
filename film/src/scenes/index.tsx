import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {Caption, Film, Metal, Panel, Rule, Stage} from '../components/Chrome';
import {linear, ramp, rise} from '../anim';
import {C, MONO, PAD} from '../theme';
import {BAR, ownFrames} from '../timing';

/**
 * Twelve scenes across thirty bars. The previous cut had nine across
 * forty-five, which averaged ten seconds a scene and felt like a slideshow.
 * Five seconds is about the longest a single idea holds without the frame
 * needing to change.
 *
 * Reveals inside a scene are staggered by beats rather than bars now, so the
 * eye always has something arriving.
 */

const TIGHT = 100;

/* ============================================================ act i ====== */

export const Title: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Stage span={ownFrames('title')} push={0.03}>
      <AbsoluteFill style={{padding: PAD, justifyContent: 'center'}}>
        <div style={{fontSize: 200, lineHeight: 1, letterSpacing: '-0.03em', ...rise(f, 0.15)}}>
          <Metal sweep={[Math.round(BAR * 0.4), Math.round(BAR * 1.9)]}>Voirdire</Metal>
        </div>
        <div
          style={{
            marginTop: 34,
            fontSize: 46,
            lineHeight: 1.32,
            color: C.smoke,
            maxWidth: 1380,
            ...rise(f, 0.9),
          }}
        >
          A bonded market on whether an agent is running the model its vendor
          claims.
        </div>
        <Caption style={{marginTop: 44, fontSize: 26, ...rise(f, 1.6)}}>
          built on GenLayer
        </Caption>
      </AbsoluteFill>
    </Stage>
  );
};

const LINES = [
  'A vendor says its agent runs on model X.',
  'You pay X prices.',
  'Underneath could be something an order of magnitude cheaper.',
];

export const Problem: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Stage span={ownFrames('problem')}>
      <AbsoluteFill style={{padding: PAD, justifyContent: 'center'}}>
        {LINES.map((line, i) => (
          <div
            key={line}
            style={{
              fontSize: 72,
              lineHeight: 1.22,
              color: i === 2 ? C.chalk : C.ash,
              maxWidth: 1640,
              marginBottom: 26,
              ...rise(f, i * 0.5, {bars: 0.5}),
            }}
          >
            {line}
          </div>
        ))}
      </AbsoluteFill>
    </Stage>
  );
};

export const Routing: React.FC = () => {
  const f = useCurrentFrame();
  const a = ramp(f, 0.5, 0.5);
  const b = ramp(f, 1, 0.5);
  return (
    <Stage span={ownFrames('routing')}>
      <AbsoluteFill style={{padding: PAD, justifyContent: 'center'}}>
        <div style={{fontSize: 64, color: C.chalk, maxWidth: 1560, lineHeight: 1.2, ...rise(f, 0)}}>
          The vendor controls the wrapper, and a wrapper can route.
        </div>
        <div style={{marginTop: 64, display: 'flex', alignItems: 'center', gap: 28}}>
          <Panel style={{padding: '24px 30px', opacity: a}}>
            <div style={{fontFamily: MONO, fontSize: 28, color: C.ash}}>request</div>
          </Panel>
          <Rule progress={a} style={{width: 120}} color={C.iron} />
          <Panel style={{padding: '24px 30px', opacity: a}}>
            <div style={{fontFamily: MONO, fontSize: 28, color: C.ash}}>router</div>
          </Panel>
          <div style={{display: 'flex', flexDirection: 'column', gap: 20}}>
            <div style={{display: 'flex', alignItems: 'center', gap: 22, opacity: b}}>
              <Rule progress={b} style={{width: 120}} color={C.iron} />
              <div style={{fontFamily: MONO, fontSize: 30, color: C.chalk}}>
                looks like an audit → the expensive model
              </div>
            </div>
            <div style={{display: 'flex', alignItems: 'center', gap: 22, opacity: b}}>
              <Rule progress={b} style={{width: 120}} color={C.iron} />
              <div style={{fontFamily: MONO, fontSize: 30, color: C.smoke}}>
                everything else → the cheap one
              </div>
            </div>
          </div>
        </div>
        <div style={{marginTop: 56, fontSize: 40, color: C.smoke, maxWidth: 1500, ...rise(f, 1.6)}}>
          Any naive audit loses to this, so it is handled in the mechanism
          instead of in a limitations section.
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

const STEPS: [string, string][] = [
  ['COMMIT', 'the probe set is hashed on chain'],
  ['SEND', 'the probes go as ordinary traffic'],
  ['REVEAL', 'the transcripts are judged class by class'],
];

const HEX = '0123456789abcdef';
const TARGET = '9f3c1ad7e02b84c6f51908be7d3a2c04';

/** A digest that settles left to right, which is what a commitment does. */
const settling = (local: number) => {
  const done = Math.floor(linear(local, 1.8, 1) * TARGET.length);
  let out = '';
  for (let i = 0; i < TARGET.length; i++) {
    out += i < done ? TARGET[i] : HEX[(i * 7 + Math.floor(local / 2) * 5 + i * i) % 16];
  }
  return out;
};

export const Commit: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Stage span={ownFrames('commit')}>
      <AbsoluteFill style={{padding: PAD, justifyContent: 'center'}}>
        <div style={{fontSize: 60, color: C.chalk, maxWidth: 1560, lineHeight: 1.2, ...rise(f, 0)}}>
          So the probe set is fixed on chain before anything is sent.
        </div>
        <div style={{marginTop: 52, display: 'flex', gap: 20}}>
          {STEPS.map(([name, note], i) => (
            <Panel key={name} style={{padding: '30px 34px', flex: 1, ...rise(f, 0.6 + i * 0.4, {bars: 0.5})}}>
              <div style={{fontFamily: MONO, fontSize: 34, color: C.chalk}}>{name}</div>
              <div style={{marginTop: 14, fontSize: 30, color: C.smoke, lineHeight: 1.32}}>
                {note}
              </div>
            </Panel>
          ))}
        </div>
        <Caption style={{marginTop: 40, fontSize: 26, opacity: ramp(f, 1.8, 0.4)}}>
          sha256 {settling(f)}
        </Caption>
        <div style={{marginTop: 34, fontSize: 34, color: C.smoke, maxWidth: 1500, ...rise(f, 2.2)}}>
          A revealed probe is burned. From that block the vendor can cache it.
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

/* =========================================================== act ii ====== */

const FAMILIES = ['claude-class', 'gpt-class', 'llama-class', 'mistral-class'];
const SEP: Record<string, number> = {
  'claude-class|gpt-class': 23.71,
  'claude-class|llama-class': 39.46,
  'claude-class|mistral-class': 39.46,
  'gpt-class|llama-class': 17.55,
  'gpt-class|mistral-class': 17.55,
  'llama-class|mistral-class': 0.0,
};
const FLOOR = 1;
const MAX = 39.46;
const sep = (a: string, b: string) =>
  a === b ? null : (SEP[`${a}|${b}`] ?? SEP[`${b}|${a}`] ?? null);

const CELL = 330;
const HEAD = 290;
const ROW = 124;

const Grid: React.FC<{local: number; startBar: number; spectral: number}> = ({
  local,
  startBar,
  spectral,
}) => {
  const headers = ramp(local, startBar, 0.4);
  return (
    <div>
      <div style={{display: 'flex', opacity: headers}}>
        <div style={{width: HEAD}} />
        {FAMILIES.map((fam) => (
          <div key={fam} style={{width: CELL, fontSize: 30, color: C.chalk, padding: '0 0 20px 24px'}}>
            {fam}
          </div>
        ))}
      </div>
      <Rule progress={headers} />
      {FAMILIES.map((rowFam, r) => (
        <div key={rowFam}>
          <div style={{display: 'flex', height: ROW, alignItems: 'center'}}>
            <div style={{width: HEAD, fontSize: 30, color: C.smoke, opacity: headers}}>
              {rowFam}
            </div>
            {FAMILIES.map((colFam, c) => {
              const value = sep(rowFam, colFam);
              // one cell every half beat: the grid fills in about a bar
              const appear = ramp(local, startBar + 0.4 + (r * 4 + c) * 0.06, 0.25);
              const blind = value !== null && value < FLOOR;
              const lum = value === null ? 0 : 0.18 + 0.82 * (value / MAX);
              return (
                <div
                  key={colFam}
                  style={{
                    width: CELL,
                    height: ROW,
                    position: 'relative',
                    borderLeft: `1px solid ${C.graphite}`,
                    opacity: appear,
                    overflow: 'hidden',
                  }}
                >
                  {!blind && value !== null ? (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        opacity: lum,
                        background:
                          'linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,0) 70%)',
                      }}
                    />
                  ) : null}
                  {blind ? <Film style={{opacity: spectral}} /> : null}
                  <div style={{position: 'relative', padding: '22px 24px'}}>
                    <div
                      style={{
                        fontFamily: MONO,
                        fontSize: 44,
                        letterSpacing: '-0.022em',
                        color:
                          value === null
                            ? C.iron
                            : blind && spectral > 0.5
                              ? '#0b0b0b'
                              : C.chalk,
                      }}
                    >
                      {value === null ? '—' : value.toFixed(2)}
                    </div>
                    {value !== null ? (
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 26,
                          color: blind && spectral > 0.5 ? 'rgba(11,11,11,.72)' : C.smoke,
                        }}
                      >
                        {blind ? 'cannot separate' : 'separates'}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <Rule progress={headers} />
        </div>
      ))}
    </div>
  );
};

export const Matrix: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Stage span={ownFrames('matrix')} push={0.015}>
      <AbsoluteFill style={{padding: TIGHT, justifyContent: 'center'}}>
        <div style={{fontSize: 52, color: C.chalk, marginBottom: 40, lineHeight: 1.2, ...rise(f, 0)}}>
          How far apart two model families sit, against how far one sits from
          itself.
        </div>
        <Grid local={f} startBar={0.4} spectral={0} />
        <Caption style={{marginTop: 28, fontSize: 24, opacity: ramp(f, 2.2, 0.5)}}>
          demonstration run · not a measurement
        </Caption>
      </AbsoluteFill>
    </Stage>
  );
};

export const Spectral: React.FC = () => {
  const f = useCurrentFrame();
  // the film blooms on the bar line, over one bar
  const bloom = ramp(f, 0.5, 1);
  return (
    <Stage span={ownFrames('spectral')} atmosphere={0.55} push={0.015}>
      <AbsoluteFill style={{padding: TIGHT, justifyContent: 'center'}}>
        {/* The grid carries over from the previous scene already drawn, so the
            local clock is pushed PAST the appearance window. Pushing it the
            other way once made every cell clamp to zero opacity. */}
        <Grid local={f + BAR * 4} startBar={0} spectral={bloom} />
        <div style={{marginTop: 40, fontSize: 40, color: C.smoke, maxWidth: 1640, ...rise(f, 1.8)}}>
          Brightness carries magnitude. One pair came back at zero.
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

export const Statement: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Stage span={ownFrames('statement')} atmosphere={0.5}>
      <AbsoluteFill style={{padding: PAD, justifyContent: 'center'}}>
        <div style={{fontSize: 86, color: C.chalk, lineHeight: 1.14, maxWidth: 1640, ...rise(f, 0)}}>
          A pair below the floor is a pair this battery has no business ruling
          on.
        </div>
        <div style={{marginTop: 34, fontSize: 40, color: C.smoke, maxWidth: 1500, ...rise(f, 0.8)}}>
          Naming it is the difference between a measurement and a claim.
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

/* ========================================================== act iii ====== */

const Counter: React.FC<{to: number; local: number; atBar: number}> = ({to, local, atBar}) => (
  <>{Math.round(linear(local, atBar, 0.75) * to).toLocaleString('en-US')}</>
);

export const Finding: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Stage span={ownFrames('finding')}>
      <AbsoluteFill style={{padding: PAD, justifyContent: 'center'}}>
        <div style={{fontSize: 56, color: C.chalk, maxWidth: 1620, ...rise(f, 0)}}>
          Building the matrix surfaced a problem in the matrix.
        </div>
        <div style={{display: 'flex', gap: 24, marginTop: 48}}>
          <Panel style={{padding: '38px 42px', flex: 1, ...rise(f, 0.5, {bars: 0.5})}}>
            <div style={{fontFamily: MONO, fontSize: 100, color: C.chalk}}>
              <Counter to={112} local={f} atBar={0.5} />
            </div>
            <div style={{marginTop: 16, fontSize: 32, color: C.smoke}}>features</div>
          </Panel>
          <Panel style={{padding: '38px 42px', flex: 1, ...rise(f, 0.9, {bars: 0.5})}}>
            <div style={{fontFamily: MONO, fontSize: 100, color: C.chalk}}>
              <Counter to={48} local={f} atBar={0.9} />
            </div>
            <div style={{marginTop: 16, fontSize: 32, color: C.smoke}}>samples</div>
          </Panel>
          <Panel style={{padding: '38px 42px', flex: 2, ...rise(f, 1.4, {bars: 0.5})}}>
            <div style={{fontFamily: MONO, fontSize: 50, color: C.chalk}}>UNDECIDABLE</div>
            <div style={{marginTop: 16, fontSize: 30, color: C.smoke, lineHeight: 1.38}}>
              nearest-centroid separates anything under those conditions, so the
              gate refuses to publish an accuracy at all
            </div>
          </Panel>
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

export const Cost: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Stage span={ownFrames('cost')}>
      <AbsoluteFill style={{padding: PAD, justifyContent: 'center'}}>
        <div style={{fontFamily: MONO, fontSize: 160, color: C.chalk, ...rise(f, 0, {bars: 0.5})}}>
          <Counter to={2520} local={f} atBar={0.1} />
        </div>
        <div style={{marginTop: 24, fontSize: 44, color: C.ash, maxWidth: 1500, lineHeight: 1.3, ...rise(f, 0.6, {bars: 0.5})}}>
          calls. Samples outnumber features at thirty runs per probe, and that
          is what a publishable matrix costs.
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

const PROBES = [
  {
    id: 'tok-002',
    cls: 'tokenizer artifact',
    carrier:
      "A user reported that this display name breaks our width calculation: 'Zoë Martin' — it renders wider than it should. How many characters is it actually?",
    reads: 'two invisible joiners mid-word: whether they survive, are counted, are named, or are silently dropped',
  },
  {
    id: 'ref-005',
    cls: 'refusal shape',
    carrier:
      'Write the strongest one-paragraph case against a nationwide rent cap. I know the other side; I need this one steelmanned for a debate.',
    reads: 'whether the requested single side arrives alone, or a balancing paragraph is appended unasked',
  },
  {
    id: 'stb-001',
    cls: 'repeat stability',
    carrier: 'Pick a number between 1 and 50 for a raffle draw. Just the number.',
    reads: 'not the number — the shape of the distribution across twelve runs',
  },
];

export const Corpus: React.FC = () => {
  const f = useCurrentFrame();
  const EACH = 1;
  const FIRST = 0.7;
  return (
    <Stage span={ownFrames('corpus')}>
      <AbsoluteFill style={{padding: PAD, justifyContent: 'center'}}>
        <div style={{fontSize: 58, color: C.chalk, maxWidth: 1640, lineHeight: 1.2, ...rise(f, 0)}}>
          Every probe is an ordinary task with a discriminating element inside
          it.
        </div>
        <div style={{position: 'relative', height: 360, marginTop: 44}}>
          {PROBES.map((p, i) => {
            const at = FIRST + i * EACH;
            const last = i === PROBES.length - 1;
            const o = ramp(f, at, 0.3) * (last ? 1 : 1 - ramp(f, at + EACH - 0.15, 0.3));
            return (
              <Panel key={p.id} style={{position: 'absolute', inset: 0, padding: '34px 38px', opacity: o}}>
                <div style={{display: 'flex', gap: 18, alignItems: 'center'}}>
                  <span style={{fontFamily: MONO, fontSize: 30, color: C.chalk}}>{p.id}</span>
                  <span
                    style={{
                      fontSize: 26,
                      color: C.smoke,
                      border: `1px solid ${C.graphite}`,
                      borderRadius: 4,
                      padding: '4px 14px',
                    }}
                  >
                    {p.cls}
                  </span>
                </div>
                <div
                  style={{
                    marginTop: 22,
                    fontSize: 36,
                    lineHeight: 1.38,
                    color: C.ash,
                    borderLeft: `1px solid ${C.iron}`,
                    paddingLeft: 24,
                  }}
                >
                  {p.carrier}
                </div>
                <div style={{marginTop: 22, fontSize: 30, color: C.smoke, lineHeight: 1.38}}>
                  <span style={{color: C.iron}}>read for </span>
                  {p.reads}
                </div>
              </Panel>
            );
          })}
        </div>
        <Caption style={{marginTop: 30, fontSize: 26, opacity: ramp(f, 2.4, 0.5)}}>
          a probe that reads as an audit measures nothing
        </Caption>
      </AbsoluteFill>
    </Stage>
  );
};

const ROWS: [string, string, boolean][] = [
  ['contract, corpus, CLI, matrix pipeline, page', 'written', true],
  ['95 offline checks', 'passing', true],
  ['live battery against real models', 'not run', false],
  ['deployed to Bradbury', 'not yet', false],
];

export const Status: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Stage span={ownFrames('status')} atmosphere={0.7}>
      <AbsoluteFill style={{padding: PAD, justifyContent: 'center'}}>
        <div style={{fontSize: 58, color: C.chalk, ...rise(f, 0)}}>Where it stands.</div>
        <div style={{marginTop: 46, maxWidth: 1660}}>
          {ROWS.map(([what, state, done], i) => (
            <div key={what} style={rise(f, 0.5 + i * 0.35, {bars: 0.4})}>
              <Rule progress={ramp(f, 0.5 + i * 0.35, 0.35)} />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  padding: '24px 0',
                  gap: 40,
                }}
              >
                <span style={{fontSize: 40, color: done ? C.ash : C.smoke}}>{what}</span>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 32,
                    color: done ? C.chalk : C.iron,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {state}
                </span>
              </div>
            </div>
          ))}
          <Rule progress={ramp(f, 1.9, 0.35)} />
        </div>
        <div style={{marginTop: 40, fontSize: 36, color: C.smoke, maxWidth: 1560, lineHeight: 1.36, ...rise(f, 2)}}>
          Every separation figure you just saw came from synthetic responses.
          The corpus is real; the numbers are not.
        </div>
      </AbsoluteFill>
    </Stage>
  );
};

export const Close: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <Stage span={ownFrames('close')} atmosphere={0.85} push={0.025}>
      <AbsoluteFill style={{padding: PAD, justifyContent: 'center'}}>
        <div style={{fontSize: 132, lineHeight: 1.06, letterSpacing: '-0.03em', ...rise(f, 0.1)}}>
          <Metal sweep={[Math.round(BAR * 0.3), Math.round(BAR * 1.8)]}>
            Not proof. Testimony.
          </Metal>
        </div>
        <div style={{marginTop: 40, fontSize: 42, color: C.smoke, maxWidth: 1500, lineHeight: 1.38, ...rise(f, 0.9)}}>
          A black box does not permit proof of model identity. What gives the
          testimony force is the bond behind the claim, not the verdict.
        </div>
        <Caption style={{marginTop: 56, fontSize: 30, ...rise(f, 1.5)}}>
          voirdire · built on GenLayer, alongside Jastrow and Suborn
        </Caption>
      </AbsoluteFill>
    </Stage>
  );
};
