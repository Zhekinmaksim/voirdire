# Frozen round-classifier candidate v1 — research only

This candidate is **not approved for identity verdicts or payouts**. It does not change the completed study's UNDECIDABLE status or the deployed class-aggregation protocol.

`v1-round-classifier.json` freezes six probes, prompt hashes, feature implementation hashes, training-only pooled scalers, centroids and rejection radii. `scripts/round_classifier.py` classifies six unique responses from text only; supplied endpoint/model metadata do not determine the decision. Exactly matching probe prompts and classes are required. Invalid evidence abstains.

The one fixed rejection rule accepts the nearest family only if its Euclidean distance is no larger than that family's training own-centroid distance 95th percentile (nearest-rank, ceil(.95×105)−1). Margin threshold is0: no additional margin rejection. Radius values are GPT4.592679697623503, Llama6.600095711444571, Mistral14.411288449611503. There is no fallback to another family after rejecting the closest one. Exact feature formulas are in the hashed classifier source and the existing hashed `features.py`; a change requires a new candidate.

A single preflight on the already-consumed development comparison half produced:

| Family | Correct / all | Abstain | Wrong | Coverage | Correct/all lower95 |
|---|---:|---:|---:|---:|---:|
| GPT | 95/105 | 10 | 0 | 90.48% | 83.35% |
| Llama | 103/105 | 2 | 0 | 98.10% | 93.32% |
| Mistral | 95/105 | 10 | 0 | 90.48% | 83.35% |

Each false-accusation upper95 bound is3.53%. This meets the development screen and motivates fresh confirmation. It does **not** validate unknown-model rejection. The training-distance radius is estimated in sample; the probe set and original classifier were selected using this same closed dataset. The intervals are descriptive and ignore that selection. All capped responses remained eligible. Single-response features associated with repeat-stability probes measure text characteristics, not repeat variance.

## Fresh confirmation plan

`v1-confirmation-plan.json` is compatible with the existing budget-reserved OpenRouter runner: six probes ×100 responses ×3 pinned model/provider combinations =1,800 responses. Group each model's same run index into one round:100 rounds/model. There is no fitting, train/test alternation or threshold selection on these data. Do not run `build_matrix.py` to evaluate this design; its three-response training/test batches describe a different experiment.

Before paid collection, record budget authorization and immutable plan/candidate/source hashes, verify current public endpoint availability and pricing against the frozen ceilings, and use a new empty output directory. The plan itself currently records no budget authorization. Its byte-based estimate at the previous quotes is **$0.803616**, not a bill guarantee; the runner continues to reserve the full context cost before each request and charge unresolved failures conservatively. Existing lock, resumable ledger, provider identity checks, stop/drain on error and no automatic ambiguous retries must remain enabled. Any recovery policy must be fixed before the first confirmation response. Do not raise price caps, replace providers or adjust sampling to obtain a passing bound.

Evaluate only after exactly1,800 verified new responses and all billing reservations/transactions are reconciled. Every model must meet both conditions using two-sided95% Wilson intervals: correct/all lower bound≥0.75 and false-accusation upper bound≤0.10. Abstentions count as incorrect for correct/all; never remove them from its denominator. Missing trials or protocol changes prevent PASS. The100-round sample is fixed, with no optional extension until significance. Compare upstream response IDs with the old dataset to rule out reuse.

Even a PASS applies only to these exact known model/provider combinations, prompts, settings and observation period. It does not authorize unknown-family claims or validate the former LLM class judge. Connecting this whole-round classifier to a new on-chain protocol requires separately verified parity, deterministic arithmetic and economic behavior. In particular, integer quantization or alternate text extraction changes the frozen decision rule and needs a new pre-collection candidate; do not silently treat it as this classifier.
