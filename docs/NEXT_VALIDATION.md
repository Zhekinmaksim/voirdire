> Historical proposal. Superseded for the current known-model scope by the preregistered integer v3 confirmation, published in commit 19df2e6 and completed with PASS. Unknown detection remains outside the validated scope.

# Next validation protocol — proposed, not executed

The completed study remains **UNDECIDABLE**, with no approved matrix. Its 13,230 responses and all 105 inspected holdout batches are now development material only. Three Llama batches were classified as Mistral; Llama's 95% upper false-accusation bound was 22.38%, above the unchanged 10% limit. See the [completed diagnostic report](../chain-and-site/calibration/README.md).

This document proposes a **revised, round-sized corpus** study. It is not a completed preregistration, a claim that the revision will work, or authorization for more paid requests. Before collection, publish a dated, immutable registration containing the exact artifacts listed below. If development cannot produce those artifacts, stop before spending on confirmation.

## What needs a separate experiment

The current nearest-centroid evaluator uses 21 probes × 3 responses per observation: 63 responses. The hosted collector accepts 2–6 unique probes per round; the contract rejects duplicate probe IDs and caps transcripts at 24. The contract's LLM judges do not consume the centroid matrix. A battery-level classifier result therefore cannot establish the reliability of an on-chain verdict.

The contract already has an abstention path: each class can return `UNCLEAR`; fewer than two concordant class readings, or conflicting readings, aggregate to `INCONCLUSIVE`. Two `MISMATCH` readings without any `MATCH` produce `INCONSISTENT`. Referees B1 and B2 then assess the visible divergence and internal consistency. They do not authenticate model weights or independently prove endpoint origin.

## Development, then an immutable freeze

Use only the completed dataset, synthetic fixtures and separately labelled exploratory work to develop one new corpus version. Target **six unique probes, two for each currently active class**: `tokenizer_artifact`, `refusal_shape`, and `repeat_stability`. Each probe produces one response in a confirmation round. This is a new measurement design; the old 112-feature battery classifier must not be silently repurposed for six-response rounds.

Inspect the known Llama/Mistral errors and output-cap effects during development. Any choice of prompt, feature, classifier, abstention rule, judge wording or token limit must finish before confirmation. Retain the existing judge abstention semantics for this candidate; do not tune a confidence cutoff after seeing new outcomes. If an alternative classifier or abstention rule is pursued instead, write a separate protocol and freeze its exact formula and parameters first.

The registration must contain:

- Exact six probe IDs, prompts, class labels and corpus SHA256; generation parameters and handling of capped, empty and tool-call responses.
- Model IDs and pinned provider routes: the existing GPT/OpenAI, Llama/Groq and Mistral/Mistral combinations listed in `calibration/status.json`. Verify availability before freezing; no provider fallback within confirmation.
- One exact fourth, out-of-scope model/provider route, selected before collection. This presently unresolved choice makes the protocol ineligible to start. It must not be picked in response to confirmation errors.
- Source commit and hashes for collector, corpus validation, envelope canonicalization, judges, analysis and recovery policy; chain ID, deployed contract address/code hash, collector identity, and available validator/judge configuration. Record infrastructure changes that cannot be pinned.
- Exact claimed model/version strings, the randomized trial schedule and seed, sample counts below, analysis implementation, cost ceiling, and an immutable registration timestamp preceding every confirmation response.

Two additional prerequisites follow from the current code. `api/collect.mjs` disables fallback but does not pin a provider `only`/`order` route, so exact routing needs reviewed collector support before this protocol can run. `_claim_context` exposes `agent_id` to judges, and the hosted agent ID contains the actual OpenRouter model ID. A substitution test with these metadata can reward reading the model name rather than distinguishing behavior. The confirmatory candidate must freeze a reviewed judge-input variant that hides the actual endpoint/model identifier while retaining the advertised claim; original receipts and endpoint identity remain available for provenance audit. The current deployed judge must not be described as blind. This change requires its own deployment and tests, and is not implemented here.

A corpus change needs corresponding collector support and reviewed tests because the collector currently permits only exact active corpus prompts. No such change is implemented by this document. Do not start until a reproducible dry run demonstrates that the frozen six-probe envelopes pass the actual deployment's validation.

## Fresh confirmation: fixed sample size

Collect **100 fresh, independently collected rounds in each of 12 strata**:

| Strata | Number | Purpose |
|---|---:|---|
| Each listed endpoint truthfully claiming its own family | 3 | Honest-claim false accusation and abstention |
| Each ordered pair of different listed endpoint/claimed family | 6 | Deliberate substitution detection |
| The frozen fourth endpoint claiming each of the three listed families | 3 | Out-of-scope behavior and unsafe acceptance |

Total: **1,200 rounds and 7,200 endpoint responses**, plus separately budgeted chain/judge operations. These are proposed counts, not a price estimate or a power guarantee. A funded, explicit cost ceiling is a prerequisite; do not use the old experiment's remaining allocation automatically.

Use one new claim per trial and one six-probe round per claim. `agent_id` and envelope endpoint identify the actual called model, while `claimed_model`/`claimed_version` encode the advertised identity; these deliberately differ in substitution strata; the trusted collector must still attest the actual endpoint and preserve its receipts. Never forge provenance to manufacture a mismatch. Submit through commit → collect → attest → reveal/judge → confirm when applicable → settlement/withdrawal. Verify the deployed API permits this test configuration before registration.

Randomize strata over 20 collection blocks, five trials per stratum per block. Collect new outputs for every trial: no reuse across claims, no old responses, no resubmitting a judged response as a fresh sample. Validator votes, three class readings and referee calls are parts of one trial, not additional independent observations. Public probes and common providers still limit generalization; disjoint response IDs alone do not establish statistical independence.

Hide confirmation results until all fixed trials and transaction reconciliations finish. Retry only according to a frozen, budget-reserved transient-error policy; retain every attempt. Do not replace an unfavorable verdict or capped response. An unrecoverable missing trial, protocol change, provider change or budget stop prevents a confirmatory PASS. Preserve the partial study and preregister a new one if necessary; do not extend this sample until a bound passes.

## Prespecified analysis and go/no-go

Report every stratum, confusion and abstention counts, capped outputs, collection failures, transaction failures, B1/B2 outcomes, and final settlement state. Calculate two-sided 95% Wilson intervals with the existing implementation. These are per-metric intervals, not simultaneous confidence across all strata. Also publish outcomes by collection block; evidence of common failure or infrastructure drift invalidates a simple independence claim and requires a new design.

All conditions below are required. The existing **0.75 lower accuracy bound** and **0.10 upper false-accusation bound** are not relaxed:

1. For each honest family, both initial `INCONSISTENT` rate and final confirmed/voided false-accusation rate must have upper bounds ≤ 0.10. Count all 100 assigned trials in the denominator.
2. For each honest stratum, correct `CONSISTENT` outcomes must have a lower bound ≥ 0.75. For every substitution stratum, correctly confirmed divergence must have a lower bound ≥ 0.75. Abstention and incomplete outcomes are not correct decisions. Report conditional accuracy too, but never use it to hide low coverage.
3. For each fourth-model stratum, the lower bound on `INCONCLUSIVE` must be ≥ 0.75, and the upper bound on false `CONSISTENT` acceptance must be ≤ 0.10. This conservative requirement is a hypothesis: the current judges are not known to satisfy it. A different treatment of unknown models would require a different registration before data collection.
4. Every economic and integrity assertion must hold: attested endpoint matches receipts; commitments and evidence hashes match; probes burn as specified; inconclusive rounds do not increment confirmed rounds or earn divergence rewards; credited refunds/payouts and withdrawals reconcile; failed transactions remain visible and cannot be counted as successful trials.
5. All frozen strata must complete without selective removal, threshold changes or confirmation-data tuning. Release enough redacted evidence and analysis to permit independent recomputation; hashes alone are insufficient.

A PASS would support only the frozen round protocol, specific endpoint/provider combinations, judges and observation period. It would not prove arbitrary model identity, unseen-provider performance or cryptographic origin. The old matrix and its `UNDECIDABLE` result remain unchanged. A new on-chain study needs its own versioned gate: the current `check_matrix.py` validates batch-classifier evidence and cannot certify these round outcomes without separately reviewed implementation.

Any failed bound, incomplete stratum or integrity failure means **no-go for identity verdicts based on this candidate**. Keep the diagnostic result visible and abstain from unsupported claims. Investigate using that study as development data, then freeze a new protocol and collect an entirely fresh confirmation set.
