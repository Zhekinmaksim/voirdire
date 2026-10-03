/**
 * THE GRID, measured rather than assumed.
 *
 * Two section boundaries in Specimen_Room.mp3 are unambiguous at 20 ms
 * resolution:
 *
 *   240.000 s   the return out of the breakdown: 239.95 s reads -28.1 dB and
 *               240.00 s reads -10.8 dB, a 17 dB step inside one 50 ms block
 *   208.000 s   the last strong downbeat before the drop. The drop is a decay
 *               rather than a cut, so the hit is the anchor, not the decay
 *
 * They sit 32.000 s apart, which is 16 bars. That forces the tempo to exactly
 * 120.000 BPM and the bar to exactly 2.000 s — which at 30 fps is exactly 60
 * frames. Downbeats in the source are at 208.000 + 2n.
 *
 * Two earlier estimates were wrong and are worth recording. A comb over the
 * whole file gave 120.0597 BPM at zero phase; its energy was 0.31 because the
 * intro and the breakdown are in it, and it put both boundaries one bar out.
 * Re-running it over only the loud region gave energy 2.33 but locked onto the
 * track's offbeat tick, 417 ms off the downbeat. The section edges beat both:
 * they are loud, sharp, and were never fitted to anything.
 *
 * THE AUDIO is pre-cut by scripts/cut-audio.sh into a 30 bar, 60.000 s edit
 * with one splice. The composition plays it from frame 0, so no trimming or
 * phase offset is needed here at all.
 *
 *   bars  0-10   full energy, into the drop          source 188-208 s
 *   bars 10-18   the breakdown, halved by the splice source 208-216, 232-240 s
 *   bars 18-30   the return                          source 240-264 s
 */

export const FPS = 30;
export const BAR = 60; // frames — exact, see above
export const BEAT = BAR / 4;
export const TOTAL_BARS = 30;
export const DURATION = TOTAL_BARS * BAR; // 1800

/** Transitions run one beat. Long enough to read as a move, short enough that
 *  the next scene is settled before the following bar line. */
export const XF = BEAT;

/**
 * Scene lengths in bars. They sum to 30.
 *
 * Act II is bars 10 to 18, which is the breakdown exactly. The cut from scene
 * 7 to scene 8 therefore lands on frame 1080, the 16 dB step where the track
 * comes back — the largest musical event in the film gets its hardest cut.
 */
export const SCENES = [
  {name: 'title', bars: 2.5},
  {name: 'problem', bars: 2},
  {name: 'routing', bars: 2.5},
  {name: 'commit', bars: 3},

  {name: 'matrix', bars: 3},
  {name: 'spectral', bars: 3},
  {name: 'statement', bars: 2},

  {name: 'finding', bars: 2.5},
  {name: 'cost', bars: 1.5},
  {name: 'corpus', bars: 3},
  {name: 'status', bars: 2.5},
  {name: 'close', bars: 2.5},
] as const;

export type SceneName = (typeof SCENES)[number]['name'];

/**
 * In a TransitionSeries the outgoing and incoming sequences overlap by the
 * transition length, so a sequence has to be its own length PLUS the transition
 * that follows it. Done this way, every scene starts exactly on its bar line
 * and the transition begins on that line rather than straddling it.
 */
export const sceneFrames = (i: number) => {
  const own = SCENES[i].bars * BAR;
  return i === SCENES.length - 1 ? own : own + XF;
};

/** Frame at which a scene starts, for reasoning about the audio. */
export const sceneStart = (name: SceneName) => {
  let at = 0;
  for (const s of SCENES) {
    if (s.name === name) return at;
    at += s.bars * BAR;
  }
  throw new Error('unknown scene ' + name);
};

export const barsOf = (name: SceneName) =>
  SCENES[SCENES.findIndex((s) => s.name === name)].bars;

/** Scene-local duration in frames, excluding the trailing transition. */
export const ownFrames = (name: SceneName) => barsOf(name) * BAR;

// Sanity: the table must sum to the composition length.
const sum = SCENES.reduce((a, s) => a + s.bars, 0);
if (sum !== TOTAL_BARS) {
  throw new Error(`scene table sums to ${sum} bars, expected ${TOTAL_BARS}`);
}
