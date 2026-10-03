# Round envelope `voirdire/2`

Voirdire adjudicates behavioural testimony. It does not prove model identity.
Every claim names an immutable evidence collector. The vendor chooses that
address when registering; challengers accept that collector when committing.
The collector is trusted to call the declared endpoint and attest the exact
responses. This is a centralized evidence trust boundary, not a provider-signed
proof. LLM referees evaluate consistency and divergence, never authenticity.

## Protocol

1. Register the claim with agent identifier, model/version, ISO date window,
   positive stake/premium, required round count, and nonzero collector address.
   The attached bond covers at least three premiums.
2. Create an envelope with a fresh random nonce and selected prompts.
3. Compute SHA-256 over the canonical **probe plan** below and call
   `commit(claim_id, digest)` with the challenge stake. Wait for acceptance.
4. The collector checks the accepted commitment and claim, runs the exact plan
   against the configured agent endpoint, and preserves response bytes and times.
5. The collector calls `attest_evidence(commit_id, envelope_digest)`. The contract
   checks sender identity and permits one attestation inside the reveal window.
6. The challenger calls `reveal(commit_id, envelope_json)`. Both the plan hash and
   collector-attested evidence hash must match. Responses are stored and judged.
7. Only INCONSISTENT rounds invoke the divergence referee; CONSISTENT and
   INCONCLUSIVE skip it (`NOT_REQUIRED`) and return the stake. An inconsistent
   admissible round needs `confirm(round_id)` for the second
   consistency referee. A confirmed divergence voids the claim. Other unresolved
   challengers receive their own stakes before the winner receives the pool.
8. Credited funds are retrieved through `withdraw()`.

Commitments hide the selected prompts before disclosure. They do not prevent an
agent from detecting probes or dynamically routing requests once it receives them.

## Envelope and hashes

```json
{
  "version": "voirdire/2",
  "claim_id": 0,
  "nonce": "d174fb1305d825d62189b7b3d60b915a",
  "endpoint": "https://agent.example/v1/chat/completions",
  "transcripts": [
    {
      "probe_id": "tok-004",
      "probe_class": "tokenizer_artifact",
      "sent": "exact prompt",
      "got": "exact response",
      "observed_at": "2026-10-03T11:20:03Z"
    }
  ]
}
```

Canonical plan includes `version`, integer `claim_id`, `nonce`, and ordered
`transcripts` entries containing only `probe_id`, `probe_class`, `sent`.
Nonempty `endpoint` is included. `got` and `observed_at` are excluded: they do
not exist when the plan is committed. Unknown keys are ignored.

Canonical evidence extends that same canonical plan with `got` on each entry
and nonempty `observed_at`. Therefore an attestation binds response bytes,
observation times, prompts, claim, nonce, ordering, and optional endpoint.
`round_hash` is the evidence hash, not the plan hash.

Both canonical forms use recursively sorted JSON keys, compact separators,
UTF-8 without ASCII escaping, and SHA-256 with lowercase hexadecimal output.
Python helpers in `cli/round.py` mirror the contract. `hash` accepts empty
responses in a plan; `check` requires filled responses.

At most 24 distinct probe IDs may occur per envelope. Each prompt and response
has a limit of 4096 Python characters. At least two active classes are required
for a conclusive verdict. Revealed IDs are burned per claim; the
`burned_probes(claim_id)` view returns `{"claim_id": ..., "probe_ids": [...]}`.

## Time and refunds

GenVM pins `datetime.now(timezone.utc)` to transaction time, consistently across
validators. Block height is not exposed. The reveal window is 86400 seconds
from the commitment transaction. Other contract calls cannot advance that clock.

An expired reveal rejects without trying to mutate state before reverting.
Anyone can call `expire_commitment`: if the collector never attested, the stake
is refunded; if it attested but the challenger withheld the reveal, the stake
stays in the claim pool. Anyone can call `expire_round` seven days after the
commitment expiry to refund a still-unsettled referee round.

A vendor may close after enough confirmed rounds, or after the declared window
expires. Active commitments and pending divergences must first be settled.
An expired claim with no confirmed rounds remains UNEXAMINED after closure.

## Read interface

`protocol_info`, `claim_count`, `get_claim`, `commitment_count`,
`get_commitment`, `round_count`, `get_round`, `report`, `burned_probes`,
`balance_of`, and `solvency` expose recovery and accounting state.
`get_round` includes the stored envelope and collector address;
`get_commitment` includes both hashes, epoch-second times, and settlement state.

Runtime time source: https://docs.genlayer.com/developers/intelligent-contracts/features/transaction-context

Judgment validation follows independent partial-field comparison: every validator
runs the same evidence task and compares the parsed decision enum or boolean.
Supporting prose may differ. There is no second LLM call merely to compare two
enums. Genuine decision disagreement remains a consensus rejection.
