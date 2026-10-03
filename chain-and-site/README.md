# Voirdire

A bonded market on the question of whether an agent's observable behaviour
matches the model its vendor claims.

A vendor says its agent runs on model X. The buyer pays X prices. Underneath
could be something an order of magnitude cheaper, and there is no deterministic
way to check: the weights are not visible and the endpoint returns text.

Voirdire does not solve that. Nothing solves that. What it does is make the
claim expensive to make falsely. A vendor bonds the claim; anyone may commit to
a probe set, run it as ordinary traffic, reveal the transcripts, and let
consensus read them class by class. A confirmed divergence takes the bond. The
statement stays statistical; the consequence becomes economic, and that is the
only reason this belongs on a chain rather than in a script.

Built on GenLayer, alongside [Jastrow](https://github.com/Zhekinmaksim/jastrow)
and [Suborn](https://github.com/Zhekinmaksim/suborn). The evidence-envelope
format, the two referee framings, the injection fencing and the pull-accounting
come from Suborn unchanged, on purpose: two contracts that disagree about
hashing cannot share a CLI.

**This is not proof of model identity.** The contract stores that sentence on
every claim and returns it from every view, so a caller cannot render a verdict
without also holding the sentence that says what it is not.

## Status

Written and passing offline. Nothing is deployed and nothing is measured.

| piece | state |
| --- | --- |
| round envelope format `voirdire/1` | written, `spec/round-envelope.md` |
| probe corpus, 21 probes across 3 classes | written, `corpus/probes.json` |
| intelligent contract | written, 95 offline checks pass |
| commit-reveal, rotation, dedup | written and tested |
| CLI: assemble, validate, canonicalize, hash | written and tested |
| feature extraction and confusion matrix | written, exercised on a fixture |
| page | built, `web/index.html` |
| design system | Hyperstudio "obsidian" via Refero Styles, plus a metal and thin-film layer, `design/DESIGN.md` |
| live battery against real models | **not run** — no key, no cross-family access |
| deploy to Bradbury | **not done** |

Every separation figure currently in `web/matrix.json` came from synthetic
responses. The page says so in a banner above everything else, `build_matrix.py`
stamps it, and `check_matrix.py` exits 2 rather than let a build publish it.

```
make test              # 95 offline checks: contract, money, dedup, canonical form
make fixture matrix page
make gate              # exits 2 on a fixture. That is the correct answer.
```

## The attack the whole design is built around

The vendor controls the wrapper and can route. Seeing a request that smells like
an audit, it forwards that one to the expensive model and everything else to the
cheap one. Any naive audit is defeated by this, so it is handled in the
mechanism rather than in a limitations section:

1. **Probes are shaped like work.** Every entry in the corpus is a task a
   customer might plausibly send, with the discriminating element inside it. A
   probe that reads as a test measures nothing.
2. **The buyer sends them, at a moment of their choosing.** Not a known auditor
   address on a schedule.
3. **Commit-reveal.** The probe set is hashed on chain before anything is sent.
   The hash covers a nonce, because the corpus is public and a commitment over
   known text alone is brute-forceable.
4. **Rotation.** A revealed probe is burned for that claim. From that block the
   vendor can cache it, whitelist it, or route it.

Point 4 has a consequence that showed up immediately in the tests and is worth
stating: two rounds against one claim must use disjoint probe sets. A corpus of
21 probes at 6 per round is three rounds before the active set is empty. The
corpus needs a supply plan, not a first batch.

The stronger path needs no probes at all: transcripts the buyer already has from
their own working traffic. The vendor could not have told those apart from
ordinary use, because they were ordinary use.

## Why the verdict is arithmetic

Consensus is asked one narrow question at a time: for this probe class alone, is
this what you would expect from the claimed family — match, mismatch or unclear
— and which fragment did you rely on. The judge is never told the stakes, never
shown the other classes, and never asked for a score.

Aggregation into `CONSISTENT` / `INCONSISTENT` / `INCONCLUSIVE` is then plain
counting in `_aggregate`, and the table is short enough to argue with:

| readings | verdict |
| --- | --- |
| two or more mismatch, no match | `INCONSISTENT` |
| two or more match, no mismatch | `CONSISTENT` |
| fewer than two classes read | `INCONCLUSIVE` |
| classes pointing opposite ways | `INCONCLUSIVE` |
| one lone mismatch among unclears | `INCONCLUSIVE` |

A model asked for both a per-class reading and an overall score will let the
score drive the reading, and the two become one opinion wearing two hats. A
single mismatch is also exactly what temperature noise produces, and paying for
it would make noise profitable.

`INCONCLUSIVE` is not a pass. There is no path from silence to a clean record: a
claim reads `UNEXAMINED` until it has survived its required number of confirmed
rounds, and `EXAMINED_NO_DIVERGENCE_FOUND` after — never *verified*, never
*proven*.

## Two things the code decides without asking a validator

Both were consensus calls in the first draft and both are cheaper and more
reliable as arithmetic:

- **Window membership.** Whether a transcript's date falls inside the claimed
  validity window is not a judgement. It is a string comparison, and a reveal
  carrying out-of-window transcripts is rejected before any prompt is built.
- **Dedup.** Same round, one extra space, is caught by flattening, exactly as in
  Suborn — and, exactly as in Suborn, judging still sees the transcript byte for
  byte, because for a tokenizer probe the zero-width characters *are* the
  measurement.

## What the matrix found about itself

`scripts/build_matrix.py` classifies leave-one-out and refuses to average blind
pairs away. Running it against a fixture where two families were made identical
by construction surfaced a real methodological problem before any money was
spent on a live run:

**With 21 probes the battery has 112 features. At the corpus's default repeat
counts that is roughly 48 samples, and nearest-centroid over more features than
samples separates anything, including two families that are the same by
construction.** The matrix now refuses to report accuracy under those conditions
and the gate returns `UNDECIDABLE`.

The number this implies is the live budget: samples outnumber features at
k ≈ 30, which is 21 probes × 30 runs × 4 families ≈ **2,520 calls**. That is
what a publishable matrix costs. It is cheap enough to be worth doing and large
enough that it should be planned rather than discovered.

With the noise stream shared, the collided pair reports separation 0.00, verdict
`BLIND`, and a false-accusation rate of 1.000 — the pipeline saying plainly that
it cannot tell two things apart. That behaviour is the point of the whole
off-chain half.

## Probe classes

Three are judged in this version. Two more are in the vocabulary so a corpus can
be built against them before a reading rubric exists; a reveal that uses them is
rejected rather than guessed at.

- `tokenizer_artifact` — how rare unicode, long digit runs, whitespace runs and
  repeats are segmented and counted
- `refusal_shape` — where the boundary sits and in what words
- `repeat_stability` — spread across identical inputs at identical settings
- `format_idiosyncrasy` — not judged yet
- `dated_knowledge` — not judged yet

Refusal-shape probes stay in the benign-borderline band: household safety, a
personal legal question, mild fiction with a ceiling the asker sets, a debate
steelman, a self-directed roast. What is measured is the shape of the boundary,
never what lies behind it. There is no jailbreak in this corpus, and a submitted
probe that reads as one is rejected rather than filed under a nearer label.

## Layout

```
contracts/voirdire.py     the contract
cli/round.py              assemble, validate, canonicalize, hash a round
spec/round-envelope.md    the format, the canonical form, the commit-reveal rules
corpus/probes.json        21 probes, marked up with what each does and does not separate
scripts/features.py       deterministic feature extraction, no model involved
scripts/run_battery.py    run probes against endpoints, or synthesize offline
scripts/build_matrix.py   leave-one-out confusion matrix and blind pairs
scripts/check_matrix.py   CI gate, exit 0 / 1 / 2 as in Jastrow
scripts/build_page.py     inline the data into a self-contained page
test/run_tests.py         95 offline checks
design/DESIGN.md          the design system, its source, and the three departures
web/index.tpl.html        the page
```

## The page

Dark, metallic, and built on **Hyperstudio — "blueprint scratched into
obsidian"** from the Refero Styles library: obsidian canvas, hairline structure,
weight 400 at every size, no drop shadows. On top of that sits a brushed-steel
and thin-film layer written for this project.

The iridescence carries the argument rather than decorating it. Iridescence is
thin-film interference — one surface returning a different colour depending on
the angle you view it from — which is this project's subject stated in optics.
Two model families can look identical under one probe class and separate under
another, and whether you can tell them apart depends on how many angles you
have.

So the page spends its spectrum in exactly one place: **colour marks only what
the instrument could not resolve.** Everything the battery separates is steel,
with brightness scaling to the separation value so the grid reads as a field
before any number is. The pairs it cannot separate are the only colour on the
page. That inverts the usual dashboard, where success is highlighted and failure
is grey; here the limit is the finding.

The corpus is a list of collapsed rows on native `<details>`, so twenty-one
probes do not turn the page into a scroll; each closed row still carries the
probe id, its class, its spectral tag if it is blind on any pair, and the opening
of the carrier task.

Three departures from the base system, and five failure modes handled on
purpose, are written down in `design/DESIGN.md` rather than made quietly.

## Next, in order

1. Get keys for three or four families and run the live battery at k = 30.
   Everything downstream of it already works.
2. Deploy to Bradbury and run one claim end to end, with the transaction
   diagnostics wired in from the first run — six transactions in the Suborn run
   never got state records and the cause was never established.
3. Grow the corpus past the rotation budget.
4. Rerun the matrix on live data. Only then does any number leave the fixture
   banner.
