# Round envelope `voirdire/1`

A round is one batch of probe transcripts submitted against one claim. It is the
unit of commit-reveal, the unit of judging, and the unit the corpus rotates on.

Suborn submits one adversarial document per envelope. Voirdire cannot: a single
response never separates model families, so the unit here is a *set*. Everything
else — inline bodies, the fence, the two referee framings, fail-closed parsing —
is carried over unchanged from `suborn/1`, and where the two formats overlap the
field names are deliberately identical.

## Why the transcript is inline, and why it is a transcript

The obvious design is to let the contract call the vendor's endpoint itself. It
was rejected for the same reason Suborn rejected live fetch, plus one worse one:

- an endpoint can be swapped after the payout, which makes every leaderboard
  entry unauditable
- the vendor sees the caller. A contract address hitting an inference endpoint
  is the single most fingerprintable client on the internet, and section 4 of
  the spec is entirely about not being fingerprintable

So the challenger runs the probes themselves and submits what came back. The
contract judges text it can see. `endpoint` is provenance only and is never
called during judging.

This moves the trust problem rather than solving it: a challenger can fabricate a
transcript. That is what stage B is for, and it is why the stake is symmetric.

## Envelope

```json
{
  "version": "voirdire/1",
  "claim_id": 0,
  "nonce": "8f2c…",
  "transcripts": [
    {
      "probe_id": "tok-004",
      "probe_class": "tokenizer_artifact",
      "sent": "…exactly what was sent to the agent…",
      "got": "…exactly what the agent returned…",
      "observed_at": "2026-09-04T11:20:03Z"
    }
  ],
  "endpoint": "",
  "author_note": "one line for the corpus reader",
  "expects": "INCONSISTENT"
}
```

| field | required | meaning |
| --- | --- | --- |
| `version` | yes | exactly `voirdire/1`, rejected on mismatch |
| `claim_id` | yes | the claim being challenged |
| `nonce` | yes | 16 to 64 hex chars, makes the commitment unguessable |
| `transcripts` | yes | 1 to 24 entries, each 1 to 4096 bytes per field |
| `transcripts[].probe_id` | yes | id in the published corpus, or `field:` prefix for saved working traffic |
| `transcripts[].probe_class` | yes | one label from the closed vocabulary |
| `transcripts[].sent` | yes | the prompt as sent, verbatim |
| `transcripts[].got` | yes | the response as received, verbatim |
| `transcripts[].observed_at` | no | provenance, compared against the claim window |
| `endpoint` | no | provenance only, never called during judging |
| `author_note` | no | one line, never enters any prompt |
| `expects` | no | the verdict the challenger claims to be forcing |

`author_note` and `expects` never enter a prompt. Anything written outside
`sent` and `got` must be inert, otherwise the envelope is an injection vector
against the corpus browser — the same rule as `suborn/1`.

## Commit-reveal

Section 4 of the spec is unenforceable without this. If the vendor can see the
probe set before answering it, the probe set is worthless.

1. challenger computes `commitment = sha256(canonical(envelope))`
2. `commit(claim_id, commitment)` writes it on chain and starts a window
3. challenger runs the probes against the agent
4. `reveal(commit_id, envelope_json)` submits the envelope; the contract
   recomputes the hash and rejects on mismatch

Order matters and is checked: a reveal whose transcripts are all timestamped
before the commit block is still accepted, but flagged, because the vendor could
not have known the probe set at that point either. What is rejected is a reveal
after the window closes — a challenger who waits gets to pick which of several
prepared envelopes to open, and that is one bit of adaptivity too many.

The nonce exists because the corpus is public. Without it the commitment is a
hash over known text and the vendor brute-forces the probe set.

## Canonical form and hashing

Two people must compute the same hash. The rules are `suborn/1`'s, extended to
the nested list:

1. drop every key not listed in the table, at every level
2. drop optional keys whose value is empty
3. serialize with sorted keys, `,` and `:` separators, no whitespace, UTF-8, no
   ASCII escaping
4. `sha256` of that string, lowercase hex

`sent` and `got` are hashed exactly as submitted. No normalization, no trimming,
no Unicode folding — for tokenizer probes the exotic characters *are* the
measurement, and folding them would erase the class.

## Two different normalizations

Same trap as Suborn, different reason.

**Judging sees the transcript verbatim.** A tokenizer probe is a question about
how the model split a rare sequence. Normalizing that sequence before judging
deletes the signal.

**Dedup sees a flattened form.** Zero-width characters removed, whitespace
collapsed, lowercased, trimmed, then joined across transcripts in submitted
order. Otherwise one working round is resubmitted with one extra space.

`cli/round.py` and `contracts/voirdire.py` implement the same flattening and are
covered by the same vectors in `test/run_tests.py`.

## Probe classes

Declared by the challenger, not verified by the contract. It exists so that the
verdict is per class rather than a single number, and so the first confirmed
discrepancy per class is the only one that earns a premium.

| class | in MVP | what it reads |
| --- | --- | --- |
| `tokenizer_artifact` | yes | how rare sequences, long digit runs and repeats are split |
| `refusal_shape` | yes | where the boundary sits and in what words it is stated |
| `repeat_stability` | yes | spread across identical inputs at identical settings |
| `format_idiosyncrasy` | no | unprompted list, dash and code-fence habits |
| `dated_knowledge` | no | where confident knowledge stops |

A class that does not separate two families is recorded as `BLIND` and is worth
exactly as much as a class that does: it is what makes the published matrix a
measurement rather than a claim.

## Verdicts

Closed vocabulary, fixed at claim registration.

- `CONSISTENT` — the profile is compatible with the claimed model
- `INCONSISTENT` — incompatible, with the classes that diverged named
- `INCONCLUSIVE` — too few rounds, unreadable evidence, or classes contradicting

`INCONCLUSIVE` is not a pass. A claim that has not survived `min_rounds`
confirmed rounds never reads as verified. Fail closed, as in Jastrow, Suborn and
Retainer.

None of these three is proof. The contract stores a `disclaimer` string on every
claim and every view returns it, so a caller cannot render a verdict without
also having the sentence that says what it is not.

## Admissibility

A round pays only if the divergence is real **and** it belongs to the claim.

Stage A: consensus reads each transcript under the rubric of its class and
returns per-class `MATCH` / `MISMATCH` / `UNCLEAR` plus the fragment it relied
on. Aggregation into a verdict is plain arithmetic in the contract, not a second
judgement — a model that is asked for both a per-class reading and an overall
score will quietly let the score drive the reading.

Stage B, two framings, both must hold:

- **B1, evidence integrity.** Is the divergence visible in the submitted text
  itself, rather than asserted by the challenger?
- **B2, object identity.** Do these transcripts belong to the agent and the
  claimed version window, rather than to some other agent or some other time?

B2 is the referee check Suborn needed and the reason the market does not
degenerate. Submitting a cheaper model's output and calling it the vendor's is
not a finding, it is a different object. Fail closed: an unparseable referee
round is inadmissible.

## Corpus record

Every judged round is written regardless of outcome. The misses are the more
useful half: forty admissible rounds against one claim with zero divergence is
the strongest statement the mechanism can make about a claim being honest.

```json
{
  "round_hash": "…",
  "claim_id": 0,
  "agent_id": "vendor/agent-7",
  "claimed_model": "family-x",
  "claimed_version": "2026-04-01",
  "verdict": "INCONSISTENT",
  "classes": [
    {"class": "tokenizer_artifact", "reading": "MISMATCH", "fragment": "…"},
    {"class": "refusal_shape", "reading": "UNCLEAR", "fragment": ""}
  ],
  "stage_b1": "ADMISSIBLE",
  "stage_b2": "ADMISSIBLE",
  "validator_set_size": 17,
  "tx": "0x…"
}
```

`claimed_version` is on the record, not just `claim_id`. Providers update models
silently; a finding belongs to an exact declared version, and when the vendor
re-registers, the old finding does not transfer — it becomes the before half of
a before-and-after.

## Rotation

A revealed probe is burned. It is in the public reveal, so from that block on
the vendor can cache it, whitelist it, or route it. `burn_revealed` marks every
`probe_id` in a reveal as spent for that claim, and the published corpus carries
the same flag so the CLI stops handing it out.

This is why the corpus needs a supply plan, not just a first batch. A corpus of
40 probes and 8 probes per round is 5 rounds before the active set is empty.
