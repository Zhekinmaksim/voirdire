# Voirdire — everything in one place

A bonded market on whether an agent is running the model its vendor claims.
Built on GenLayer, alongside Jastrow and Suborn.

```
voirdire/
  chain-and-site/     the contract, the probe corpus, the CLI, the matrix
                      pipeline and the published page
  film/               the Remotion project for the 60 second film
  voirdire-60s.mp4    the rendered film, 1920x1080, 38 MB
```

Read `chain-and-site/README.md` for the mechanism and `film/README.md` for how
the cut is timed. Local checks and website deployment are described below.

## GitHub and Vercel

Import the repository into Vercel with the repository root as Root Directory
and Framework Preset **Other**. The checked-in `vercel.json` builds with
`python3 scripts/build_site.py` and publishes only `dist/`. No npm install,
provider keys, or film render is needed for the website. Vercel configuration:
https://vercel.com/docs/project-configuration/vercel-json

The default `SITE_MODE=demo` accepts only fixture data and keeps a synthetic-data
notice visible even before JavaScript loads. This publishes a demonstration,
not a measured verdict; `make gate` still rejects the fixture with exit 2.
For live results, set `SITE_MODE=measured` in Vercel after replacing
`chain-and-site/web/matrix.json`. That build runs the original measurement gate
and fails unless it passes. Unknown modes and provenance mismatches fail closed.
Set the matching `SITE_MODE` in the GitHub workflow when switching to live data.

```bash
python3 scripts/build_site.py
python3 -m http.server 8765 --directory dist
# http://localhost:8765
```

GitHub Actions runs the 95 offline checks, builds the website, and verifies
that fixture data remains UNDECIDABLE and cannot pass a measured build.
Python caches, environment files, private round envelopes, and live run files
are ignored by Git. The film remains in the repository but is excluded from
Vercel uploads. Connect `voirdire.pro` in Vercel Domains after deployment.

Published demo: https://voirdire-mu.vercel.app
Repository: https://github.com/Zhekinmaksim/voirdire
Vercel is connected to the repository for subsequent deployments.
The custom domain `voirdire.pro` is not configured yet.

---

## What you need installed

| | why |
| --- | --- |
| Python 3.11+ | the contract tests, the CLI, the matrix pipeline |
| Node 20+ | the film |
| ffmpeg | the audio edit in `film/scripts/cut-audio.sh` |

Nothing else. The contract tests run against a local stub, so they need no
network, no keys and no chain.

---

## 1. Confirm it still works (2 minutes)

```bash
cd chain-and-site
make test           # 95 offline checks
make fixture matrix page
open web/index.html
```

`make gate` is supposed to exit 2 and print `UNDECIDABLE`. That is correct — it
is refusing to publish numbers that came from a fixture. If it ever exits 0 on
fixture provenance, something has broken in `scripts/check_matrix.py`.

## 2. The live battery — the one thing actually blocking the project

Everything downstream of this already works; it has simply never been fed real
responses. You need keys for three or four model families:

```bash
cd chain-and-site
export OPENAI_API_KEY=...        # gpt-class
export ANTHROPIC_API_KEY=...     # claude-class
export TOGETHER_API_KEY=...      # llama-class
export MISTRAL_API_KEY=...       # mistral-class

python3 scripts/run_battery.py --family gpt-class     --model gpt-4o           --provider openai   --k 30 --out runs/gpt.jsonl
python3 scripts/run_battery.py --family claude-class  --model claude-sonnet-4-6 --provider anthropic --k 30 --out runs/claude.jsonl
python3 scripts/run_battery.py --family llama-class   --model <llama id>       --provider together --k 30 --out runs/llama.jsonl
python3 scripts/run_battery.py --family mistral-class --model <mistral id>     --provider mistral  --k 30 --out runs/mistral.jsonl

cat runs/*.jsonl > runs/live.jsonl      # keep only the first header line
python3 scripts/build_matrix.py runs/live.jsonl --out web/matrix.json
python3 scripts/build_page.py
python3 scripts/check_matrix.py web/matrix.json
```

**Why k=30 and not the corpus defaults.** 21 probes produce 112 features. At
the default repeat counts that is about 48 samples, and nearest-centroid over
more features than samples separates anything — including two families that are
identical by construction. `build_matrix.py` refuses to report an accuracy under
those conditions and the gate returns `UNDECIDABLE`. Samples outnumber features
at thirty runs per probe, which is **21 × 30 × 4 ≈ 2,520 calls**. That is the
price of a publishable matrix. Budget for it rather than discovering it.

`--sleep` throttles if a provider rate-limits you. Failed calls are recorded
with their error and skipped by the scorer rather than silently dropped.

Only once this has run does any number on the page stop being a fixture. Until
then the banner stays, and that is deliberate.

## 3. Deploy to Bradbury

The contract is one file, `chain-and-site/contracts/voirdire.py`, with its
`Depends` header already pinned to the same py-genlayer build as Jastrow and
Suborn. Deploy it the way you deployed those.

Two things worth doing differently this time:

- **Wire transaction diagnostics from the first run.** Six transactions in the
  Suborn run never got state records and the cause was never established. Log
  the tx hash and the returned receipt for every call from the start, so if it
  happens again there is something to look at.
- **`_tick` is a stand-in for block height.** The commit-reveal window is
  counted in state-changing calls against the contract, because this code does
  not assume the runtime exposes a block number. The limitation is real: anyone
  generating traffic can tick someone else's window closed. They cannot read or
  forge the commitment, which is what the window protects. If Bradbury exposes
  block height, swapping the body of `_tick` is the only change needed —
  nothing else in the file touches it.

Then run one claim end to end: `register_claim` → `commit` → `reveal` →
`confirm` → `withdraw`. `cli/round.py` builds and hashes the envelope:

```bash
python3 cli/round.py new --claim 0 --per-class 2 > round.json
# send the `sent` fields to the agent yourself, paste the responses into `got`
python3 cli/round.py check round.json
python3 cli/round.py hash round.json     # this is what you commit
```

Commit the hash **before** sending the probes. Doing it in the other order makes
the whole exercise meaningless, which is why the CLI prints that warning.

## 4. The corpus needs a supply plan

A revealed probe is burned for that claim. 21 probes at 6 per round is three
rounds before the active set is empty, so two rounds against one claim already
have to use disjoint probe sets. Growing the corpus past the rotation budget is
cheap work that nothing else is blocked on — the format is documented in
`chain-and-site/spec/round-envelope.md` and the markup rules are at the top of
`corpus/probes.json`.

## 5. The film

```bash
cd film
npm install
./scripts/cut-audio.sh      # rebuilds public/specimen-cut.m4a from the mp3
npm run studio              # preview and scrub
npm run render              # out/voirdire-60s.mp4
```

`public/specimen-cut.m4a` is already in the archive, so the render works without
running the cut script. Run it only if you change the edit.

Rendered here on a single core at about three frames per second — roughly ten
minutes. On your machine raise `--concurrency` to your core count and it is a
couple of minutes.

**Fonts.** The stack falls back to the system sans. Geist and Geist Mono are
what the design system names; install them locally, or wire
`@remotion/google-fonts` for Inter and IBM Plex Mono, and the render matches the
site exactly. Without them it still renders, just in a different face.

**If `npm run render` cannot fetch a browser,** `film/README.md` documents the
workaround used here: the Chromium binary ships inside the `@sparticuz/chromium`
npm package as brotli, and Remotion takes `--browser-executable`. You will
probably not need it.

---

## Where the project actually stands

| | |
| --- | --- |
| contract, corpus, CLI, matrix pipeline, page, film | written |
| 95 offline checks | passing |
| live battery against real models | **not run** — step 2 above |
| deployed to Bradbury | **not done** — step 3 above |

Every separation figure currently on the page and in the film came from
synthetic responses. The corpus is real; the numbers are not, the page says so
in a banner above everything else, and the gate will not let a build publish
them as measured.
