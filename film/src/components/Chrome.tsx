import React from 'react';
import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';
import {C, EDGE, FILM, METAL_TEXT, MONO, SANS, STEEL} from '../theme';
import {BAR} from '../timing';

/**
 * Film grain, and the fix for the flicker.
 *
 * The first version regenerated the feTurbulence seed every second frame. At
 * 30 fps that is a fresh full-screen noise field fifteen times a second, which
 * does not read as grain — it reads as television static, and it was the main
 * reason the film looked like it was flickering.
 *
 * Now the field is generated once and slid instead. A static texture in slow
 * translation has no popping at all, because no pixel ever changes without its
 * neighbours changing with it. The tile is oversized and the layer inset past
 * the frame so the slide never exposes an edge.
 */
const GRAIN_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' seed='7'/></filter><rect width='400' height='400' filter='url(%23n)' opacity='.5'/></svg>`;

export const Grain: React.FC<{opacity?: number}> = ({opacity = 0.17}) => {
  const frame = useCurrentFrame();
  const drift = frame * 0.35;
  return (
    <AbsoluteFill
      style={{
        inset: -80,
        opacity,
        pointerEvents: 'none',
        backgroundImage: `url("data:image/svg+xml,${GRAIN_SVG.replace(/#/g, '%23')}")`,
        backgroundPosition: `${drift}px ${drift * 0.6}px`,
      }}
    />
  );
};

/** The low iridescent wash that sits under everything. Inert, never in focus. */
export const Atmosphere: React.FC<{intensity?: number}> = ({intensity = 1}) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 240) * 3;
  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        opacity: intensity,
        filter: 'blur(40px)',
        background: `
          radial-gradient(52% 40% at ${18 + drift}% 0%, rgba(127,216,255,.10), transparent 62%),
          radial-gradient(46% 38% at ${86 - drift}% 8%, rgba(213,155,255,.09), transparent 64%),
          radial-gradient(60% 46% at 50% 104%, rgba(185,242,196,.05), transparent 66%)`,
      }}
    />
  );
};

/**
 * Every scene sits on a slow push. Two per cent of scale across a scene is
 * below the threshold where you notice it as a zoom, but it is enough that a
 * held frame is never actually still, which is most of what "more dynamic"
 * means in practice. It costs nothing and it is not a flicker.
 */
export const Stage: React.FC<{
  children: React.ReactNode;
  atmosphere?: number;
  /** Scene length in frames, so the push spans the scene rather than a guess. */
  span?: number;
  push?: number;
}> = ({children, atmosphere = 1, span = 180, push = 0.02}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, span], [1, 1 + push], {
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{backgroundColor: C.obsidian, fontFamily: SANS}}>
      <Atmosphere intensity={atmosphere} />
      <AbsoluteFill style={{transform: `scale(${scale})`}}>{children}</AbsoluteFill>
      <Grain />
    </AbsoluteFill>
  );
};

/**
 * Gradient clipped to the glyphs, with the highlight allowed to travel.
 *
 * The first version overlaid a white band in `mix-blend-mode: screen`. On a
 * 1080p render that composited as a hard grey rectangle across the wordmark:
 * the band is wider than its own box and there is nothing behind it to screen
 * against. Moving the gradient's own background-position is clipped to the
 * letters by construction, needs no blend mode, and cannot escape the glyphs.
 */
export const Metal: React.FC<{
  children: React.ReactNode;
  /** Frames over which the highlight crosses the word. */
  sweep?: [number, number];
  style?: React.CSSProperties;
}> = ({children, sweep, style}) => {
  const frame = useCurrentFrame();
  const pos = sweep
    ? interpolate(frame, sweep, [175, -75], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      })
    : 50;
  return (
    <span
      style={{
        backgroundImage: METAL_TEXT,
        backgroundSize: '220% 100%',
        backgroundPosition: `${pos}% 0`,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        WebkitTextFillColor: 'transparent',
        ...style,
      }}
    >
      {children}
    </span>
  );
};


/** Bevelled dark plate: gradient border plus brushed surface. */
export const Panel: React.FC<{
  children?: React.ReactNode;
  style?: React.CSSProperties;
  radius?: number;
}> = ({children, style, radius = 8}) => (
  <div
    style={{
      position: 'relative',
      borderRadius: radius,
      border: '1px solid transparent',
      background: `linear-gradient(${C.carbon},${C.carbon}) padding-box, ${EDGE} border-box`,
      ...style,
    }}
  >
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: radius,
        pointerEvents: 'none',
        background: `${STEEL}, repeating-linear-gradient(90deg,rgba(255,255,255,.014) 0 1px,transparent 1px 3px)`,
      }}
    />
    <div style={{position: 'relative'}}>{children}</div>
  </div>
);

/** The spectral surface. Drifts slowly; never used except on an unresolved pair. */
export const Film: React.FC<{style?: React.CSSProperties; speed?: number}> = ({
  style,
  speed = 1,
}) => {
  const frame = useCurrentFrame();
  const pos = (frame * 0.28 * speed) % 300;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: '#cdd6df',
        backgroundImage: FILM,
        backgroundSize: '300% 100%',
        backgroundPosition: `${pos}% 0`,
        ...style,
      }}
    />
  );
};

/** A hairline that draws itself in. Structure arriving, rather than fading up. */
export const Rule: React.FC<{
  progress: number;
  style?: React.CSSProperties;
  color?: string;
}> = ({progress, style, color = C.graphite}) => (
  <div
    style={{
      height: 1,
      backgroundColor: color,
      transform: `scaleX(${Math.max(0, Math.min(1, progress))})`,
      transformOrigin: 'left center',
      ...style,
    }}
  />
);

export const Caption: React.FC<{children: React.ReactNode; style?: React.CSSProperties}> = ({
  children,
  style,
}) => (
  <div
    style={{
      fontFamily: MONO,
      fontSize: 20,
      letterSpacing: '-0.022em',
      color: C.iron,
      ...style,
    }}
  >
    {children}
  </div>
);

/**
 * Standing chrome. Without it every scene is a block of text floating in an
 * otherwise empty 1920x1080, which reads as an unfinished slide rather than as
 * a film. It also gives the eye one fixed reference, so the cuts land against
 * something that does not move.
 */
const ACTS: [number, string][] = [
  [0, 'i \u00b7 the claim'],
  [600, 'ii \u00b7 the limit'],   // bar 10, where the track drops
  [1080, 'iii \u00b7 the record'], // bar 18, where it comes back
];

export const Frame: React.FC<{total: number}> = ({total}) => {
  const frame = useCurrentFrame();
  let label = ACTS[0][1];
  for (const [at, name] of ACTS) if (frame >= at) label = name;
  const progress = Math.min(1, frame / total);
  const fade = interpolate(frame, [0, BAR], [0, 1], {extrapolateRight: 'clamp'});

  return (
    <AbsoluteFill style={{pointerEvents: 'none', opacity: fade}}>
      <div
        style={{
          position: 'absolute',
          top: 56,
          left: 128,
          right: 128,
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: MONO,
          fontSize: 24,
          letterSpacing: '-0.022em',
          color: C.iron,
        }}
      >
        <span>voirdire</span>
        <span>{label}</span>
      </div>
      <div style={{position: 'absolute', left: 128, right: 128, bottom: 56}}>
        <div style={{height: 1, backgroundColor: C.graphite}} />
        <div
          style={{
            height: 1,
            marginTop: -1,
            backgroundColor: C.iron,
            transform: `scaleX(${progress})`,
            transformOrigin: 'left center',
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
