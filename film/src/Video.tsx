import React from 'react';
import {AbsoluteFill, Audio, staticFile} from 'remotion';
import {TransitionSeries, linearTiming} from '@remotion/transitions';
import type {TransitionPresentation} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {slide} from '@remotion/transitions/slide';
import {wipe} from '@remotion/transitions/wipe';
import {DURATION, SCENES, XF, sceneFrames} from './timing';
import {C} from './theme';
import {Frame} from './components/Chrome';
import {
  Close,
  Commit,
  Corpus,
  Cost,
  Finding,
  Matrix,
  Problem,
  Routing,
  Spectral,
  Statement,
  Status,
  Title,
} from './scenes';

const COMPONENTS = {
  title: Title,
  problem: Problem,
  routing: Routing,
  commit: Commit,
  matrix: Matrix,
  spectral: Spectral,
  statement: Statement,
  finding: Finding,
  cost: Cost,
  corpus: Corpus,
  status: Status,
  close: Close,
} as const;

/**
 * One transition per cut, chosen for what the cut has to do rather than for
 * variety. Straight cross-fades everywhere was most of why the previous
 * version felt inert.
 *
 * Timing is linear, not spring: a spring overshoots by an amount that depends
 * on its physics, and the whole point here is that the move starts exactly on
 * the bar line and is finished one beat later, before the next.
 *
 * The two that matter:
 *
 *   commit -> matrix    a slide up, entering the breakdown. The track drops on
 *                       this frame, so the picture moves with it.
 *   statement -> finding  a wipe up on frame 1080, which is the 16 dB step
 *                       where the track returns. The hardest cut in the film
 *                       sits on its loudest event.
 *
 * matrix -> spectral is a fade on purpose: the grid must appear to stay put
 * while only its surface changes.
 */
// Heterogeneous presentations, so the array needs the loose element type.
const TRANSITION: TransitionPresentation<Record<string, unknown>>[] = [
  wipe({direction: 'from-left'}),   // title -> problem
  slide({direction: 'from-right'}), // problem -> routing
  fade(),                           // routing -> commit
  slide({direction: 'from-bottom'}),// commit -> matrix      the drop
  fade(),                           // matrix -> spectral    continuity
  fade(),                           // spectral -> statement
  wipe({direction: 'from-bottom'}), // statement -> finding  the return
  wipe({direction: 'from-left'}),   // finding -> cost
  slide({direction: 'from-right'}), // cost -> corpus
  wipe({direction: 'from-left'}),   // corpus -> status
  fade(),                           // status -> close
];

export const Voirdire: React.FC = () => (
  <AbsoluteFill style={{backgroundColor: C.obsidian}}>
    {/* Pre-cut to 30 bars by scripts/cut-audio.sh, so it plays from zero with
        no trim and no phase offset. */}
    <Audio
      src={staticFile('specimen-cut.m4a')}
      volume={(f) =>
        f > DURATION - 24 ? Math.max(0, (DURATION - f) / 24) : 1
      }
    />

    <TransitionSeries>
      {SCENES.map((scene, i) => {
        const Component = COMPONENTS[scene.name];
        const nodes = [
          <TransitionSeries.Sequence
            key={scene.name}
            durationInFrames={sceneFrames(i)}
          >
            <Component />
          </TransitionSeries.Sequence>,
        ];
        if (i < SCENES.length - 1) {
          nodes.push(
            <TransitionSeries.Transition
              key={scene.name + '-x'}
              presentation={TRANSITION[i]}
              timing={linearTiming({durationInFrames: XF})}
            />,
          );
        }
        return nodes;
      })}
    </TransitionSeries>

    <Frame total={DURATION} />
  </AbsoluteFill>
);
