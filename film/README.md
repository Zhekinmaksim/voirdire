# Voirdire: the v3 film

The current 60-second cut presents real v3 confirmation and finalized settlement
controls on **GenLayer Bradbury testnet**. The metal, obsidian and interference
film design, twelve-scene timing and original music edit are preserved.

The ready-to-watch file is `../voirdire-60s.mp4`. The earlier synthetic cut remains
recoverable from Git history; it is not current release evidence.

## Render

Python 3.11+, Node 20+. The complete repository is required because the film's
facts are checked against the product's approved release.

```sh
cd film
npm ci
npm run typecheck
npm run render
```

Rendering writes `out/voirdire.mp4`. After verifying the output, copy it to the
release file with `cp out/voirdire.mp4 ../voirdire-60s.mp4`.

Remotion normally obtains its browser automatically. To use Chrome already
installed on macOS:

```sh
npm run render -- --browser-executable='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --concurrency=4
```

`npm run studio` opens the editor. `npm run still -- --frame=915` renders a sample
frame. All these commands first run `prepare:release`.

1920×1080, 30 fps, 1,800 video frames. AAC stereo uses the existing
`public/specimen-cut.m4a`; no new soundtrack or voiceover is required. Audio
encoding padding can make the MP4 container slightly longer than 60 seconds.

## Evidence, not hand-entered scores

`scripts/prepare-release.mjs` generates `src/release.json` after the product's
`prepare_web.py` validates the frozen confirmation and deployment bindings.
Rendering stops if the profile, confirmation hash, model routes, probe prompts,
live controls or finalized withdrawal no longer match the story.

The film presents:

- 1,800 fresh responses in 300 whole six-probe rounds, 100 per endpoint.
- GPT: 93 matches / 7 abstentions; Llama: 95 / 5; Mistral: 94 / 6.
- Zero observed wrong-family decisions, with a per-model 95% upper bound of
  3.699%. Unknown models and future endpoint changes are not certified.
- A collector fixed at registration. It signs the responses it obtains; it
  cannot prove which weights the provider ran.
- Commit, collect, attest, publish and whole-profile judgement. Published
  probes are spent for that claim; the frozen profile supports one round.
- Three separate finalized controls: INCONSISTENT, CONSISTENT and INCONCLUSIVE.
- A finalized native withdrawal of 0.000009 **testnet** GEN whose exact arrival
  was independently checked. This is not a real-money deployment.

Scientific confirmation and economic controls are separate evidence. The earlier
full-corpus study remains UNDECIDABLE and is not pooled with the v3 confirmation.
The closing claim remains “Not proof. Testimony.”

## The cut

| Time | Scene |
| --- | --- |
| 0–5 s | Voirdire, bonded behavioural testimony |
| 5–9 s | A declaration, observable responses, a bond |
| 9–14 s | Trusted collector and pinned provider route |
| 14–20 s | Commit → collect → publish → judge |
| 20–26 s | Actual confirmation confusion counts |
| 26–32 s | Spectral ABSTAIN cells, retained in the denominator |
| 32–36 s | False-accusation confidence bound and scope |
| 36–41 s | Three finalized live controls |
| 41–44 s | Native withdrawal reached the wallet |
| 44–50 s | The six exact frozen probes |
| 50–55 s | Current testnet status and application |
| 55–60 s | Not proof. Testimony. voirdire.pro |

The track is 120 BPM: one bar is 60 frames at 30 fps. Scene lengths still sum to
30 bars. One-beat overlaps keep the matrix entrance at frame 600 and the live
control entrance at frame 1080, the musical return.

The existing audio edit uses decoded PCM from `Specimen_Room.mp3`: 188–216 seconds
followed by 232–264 seconds, with short fades at the splice. Run
`./scripts/cut-audio.sh` only when changing that edit. The composition fades the
last 24 frames.

## Typography and materials

Geist Sans Regular and Geist Mono Regular are bundled in `public/fonts/`, loaded
through `@remotion/fonts`, and awaited before any frame can render. Failed font
loading fails the render; it cannot silently switch to system fonts. Source
commit, URLs and SHA-256 digests are in `public/fonts/SOURCE.json`; the included
`OFL.txt` applies to the fonts.

The visual system retains the original brushed steel, clipped metallic text,
static-seed grain and small scene pushes. Spectrum marks unresolved outcomes,
including ABSTAIN and INCONCLUSIVE. Supplementary captions now have readable
contrast. Dependencies are pinned for repeatable installation.

See [AUDIT.md](AUDIT.md) for verification and the original cut's archived audit.
The film source is excluded from Vercel deployment; the MP4 is a repository and
local release artifact.
