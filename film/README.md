# Voirdire — 60 second film

A 1:00 cut about the Voirdire project, edited to `Specimen_Room.mp3`.

This is the original **historical, synthetic demonstration**, not a current v3
launch film. Its live-run and deployment status captions are outdated. The
composition still typechecks and renders; see [AUDIT.md](AUDIT.md) for the
2026-10-03 verification and the content changes required before publication.

    npm install
    ./scripts/cut-audio.sh   # builds public/specimen-cut.m4a, 30 bars
    npm run studio
    npm run render           # out/voirdire.mp4

1920x1080, 30 fps, 1800 frames, twelve scenes.

## The grid, measured rather than assumed

Two section boundaries in the track are unambiguous at 20 ms resolution:

    240.000 s   the return out of the breakdown. 239.95 s reads -28.1 dB and
                240.00 s reads -10.8 dB: a 17 dB step inside one 50 ms block.
    208.000 s   the last strong downbeat before the drop. The drop itself is a
                decay rather than a cut, so the hit is the anchor.

They sit 32.000 s apart, which is 16 bars. That forces the tempo to exactly
**120.000 BPM**, the bar to exactly **2.000 s**, and the bar to exactly **60
frames**. Downbeats in the source are at 208.000 + 2n.

Two earlier estimates were wrong and both are recorded in `src/timing.ts`. A
comb over the whole file gave 120.0597 BPM at zero phase; its energy was 0.31
because the intro and the breakdown were in it, and it put both boundaries one
bar out. Re-running over only the loud region raised the energy to 2.33 but
locked onto the track's offbeat tick, 417 ms off the downbeat. The section edges
beat both estimates: they are loud, sharp, and were never fitted to anything.

## The audio edit

`scripts/cut-audio.sh` builds a 30 bar, 60.000 s edit with one splice:

    segment A   188.000 s + 28.000 s   14 bars: 10 into the drop, 4 after it
    segment B   232.000 s + 32.000 s   16 bars: 4 of ramp, 12 of the return

The breakdown is 16 bars in the source. Half the film spent inside it would
fight a cut that is supposed to move, so it is halved. The joint is 216.000 s to
232.000 s, both at about -23.5 dB — the quietest pair of bar lines available and
the easiest place in the track to hide a cut. Verified after the fact: the sharp
return survives at 36.000 s in the edit, -27.8 dB to -11.6 dB across one block.

Seeking is done on decoded PCM, never on the MP3. The first attempt used `-ss`
on the MP3 and came out 46 ms late, because seeking an MP3 lands on the nearest
encoded frame and at 48 kHz those are 24 ms apart. 46 ms is 1.4 frames, enough
to put every cut in the film behind the beat.

The composition plays the edit from frame 0, so there is no trim and no phase
offset in the code at all.

## Structure

| act | bars | frames | scenes |
| --- | --- | --- | --- |
| I — the claim | 0–10 | 0–600 | title, problem, routing, commit |
| II — the limit | 10–18 | 600–1080 | matrix, spectral, statement |
| III — the record | 18–30 | 1080–1800 | finding, cost, corpus, status, close |

Act II is the breakdown exactly. Twelve scenes across thirty bars averages five
seconds each; the previous cut ran nine scenes across forty-five bars, which
averaged ten and read as a slideshow.

## Transitions

`TransitionSeries`, one beat each, linear rather than spring — a spring
overshoots by an amount that depends on its physics, and the point is that the
move starts exactly on the bar line and is done before the next one.

A sequence has to be its own length **plus** the transition that follows it,
because the two overlap; `sceneFrames` in `src/timing.ts` does that, which is
what keeps every scene starting on its bar.

Two cuts carry the film:

- **commit → matrix**, a slide up on frame 600, where the track drops.
- **statement → finding**, a wipe up on frame 1080, the 16 dB step where the
  track returns. The hardest cut sits on the loudest event.

**matrix → spectral** is a plain fade on purpose: the grid has to appear to stay
put while only its surface changes.

## The flicker, and what caused it

The 90 second version flickered constantly. Two mistakes, both mine:

- **The grain regenerated its `feTurbulence` seed every second frame.** At 30 fps
  that is a fresh full-screen noise field fifteen times a second, which does not
  read as grain, it reads as television static. The field is now generated once
  and slid slowly instead: no pixel ever changes without its neighbours changing
  with it.
- **A `BarPulse` component flashed the whole frame white at 2.2% opacity on every
  bar.** Intended as a heartbeat, it was a strobe at 0.5 Hz. Removed entirely.

Measured after the fix, two adjacent frames in a held moment differ by a mean of
0.86 levels out of 255, with 0.36% of pixels changing by more than four levels.
That is the slow grain drift and the scene push, and nothing else.

Dynamism now comes from things that are not flashes: twelve cuts instead of
nine, reveals staggered by beats rather than bars, and a two per cent scale push
across every scene — below the threshold where you read it as a zoom, but enough
that a held frame is never actually still.

## Design

Same system as the site, documented in `design/DESIGN.md` of the main
repository: Hyperstudio "blueprint scratched into obsidian" from Refero Styles,
plus this project's brushed-steel and thin-film layer.

The governing rule carries over unchanged: **colour marks only what the
instrument could not resolve.** Everything the battery separates is steel, with
each cell's highlight scaling to its separation value. The spectrum appears on
the cells of the one pair that came back BLIND, and nowhere else in sixty
seconds.

The matrix on screen is the repository's *collided* fixture — the run where two
families were made identical by construction, to check that the pipeline reports
BLIND instead of inventing a separation. It is labelled `demonstration run · not
a measurement` on screen, and Act III says plainly that nothing has been run
against a real model.

## Rendering notes

Rendered here on a single core with software rasterisation, about three frames
per second, so roughly ten minutes. Raise `--concurrency` to your core count.

Remotion could not download its own Chrome in this environment, so the browser
came out of the `@sparticuz/chromium` npm package, which ships the binary inside
the tarball as brotli:

    npm i -D @sparticuz/chromium
    node -e "const z=require('zlib'),f=require('fs');f.writeFileSync('.browser/chromium',z.brotliDecompressSync(f.readFileSync('node_modules/@sparticuz/chromium/bin/chromium.br')))"
    chmod +x .browser/chromium
    npx remotion render Voirdire out/film.mp4 --browser-executable=./.browser/chromium --gl=swangle

You almost certainly do not need this — plain `npm run render` will fetch a
browser normally. It is written down because it is the only reason the stills in
this repository exist, and the stills are what caught the bugs.

CRF is 20. At CRF 16 with the old animated grain the same film came out 200 MB;
static grain at CRF 20 is 38 MB and looks the same.

Fonts fall back through a stack. Geist and Geist Mono are what the design system
names. Bundle and load the chosen fonts in the project to make typography
reproducible. The original site uses a different fallback stack, so installing
Geist alone does not guarantee an exact site match.
