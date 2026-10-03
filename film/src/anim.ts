import {Easing, interpolate} from 'remotion';
import {BAR} from './timing';

/**
 * Everything enters on a bar line. The argument is: an eased fade with an
 * arbitrary keyframe reads as motion applied to a video, and a cut on the bar
 * reads as the video being cut to the music. The second one is free and looks
 * deliberate, so nothing here takes a hand-picked frame number — offsets are
 * given in bars or beats and converted here.
 */

const OUT = Easing.bezier(0.16, 1, 0.3, 1);

/** Fade and lift, starting `atBar` bars into the scene. */
export const rise = (
  local: number,
  atBar: number,
  opts: {distance?: number; bars?: number} = {},
) => {
  const {distance = 14, bars = 0.75} = opts;
  const start = atBar * BAR;
  const end = start + bars * BAR;
  const t = interpolate(local, [start, end], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: OUT,
  });
  return {
    opacity: t,
    transform: `translateY(${(1 - t) * distance}px)`,
  };
};

/** Plain 0..1 ramp over a span given in bars. */
export const ramp = (local: number, atBar: number, bars = 1) =>
  interpolate(local, [atBar * BAR, (atBar + bars) * BAR], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: OUT,
  });

/** Linear ramp, for counters and anything that should not ease. */
export const linear = (local: number, atBar: number, bars = 1) =>
  interpolate(local, [atBar * BAR, (atBar + bars) * BAR], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

/** Fade the whole scene out over its last `bars`, so cuts are never hard
 *  unless a hard cut is the point. */
export const tail = (local: number, duration: number, bars = 0.5) =>
  interpolate(local, [duration - bars * BAR, duration], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
