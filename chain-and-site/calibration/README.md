# Calibration records

The active v3 release passed a separate preregistered fresh confirmation: 1,800
responses, 100 six-response rounds for each pinned model/provider. The classifier,
output policy and thresholds were frozen before collection. See
[confirmation-v3](confirmation-v3/README.md) for the raw data, ledger and report,
[the immutable preregistration](candidates/int-v3/manifest.json), and
[protocol verification](../../PRODUCTION_STATUS.md) for live economic controls.
Its scope is the three exact model/provider combinations; this is behavioural
classification, not proof of identity.

The candidate README and manifest preserve their original pre-collection status.
The later confirmation and contract approval are recorded separately.

## Original 21-probe battery: UNDECIDABLE

[status.json](status.json) is a **diagnostic report, not an approved matrix**. The live battery completed, but the evidence does not support publishing model-identity verdicts. The gate returned **UNDECIDABLE (exit 2)**; its thresholds were not relaxed.

The frozen collection plan covered 21 probes, 210 responses per probe and three pinned model/provider combinations:

| Family label | Model ID | Provider endpoint |
|---|---|---|
| GPT | `openai/gpt-4o-mini` | OpenAI / `openai` |
| Llama | `meta-llama/llama-3.3-70b-instruct` | Groq / `groq` |
| Mistral | `mistralai/mistral-small-3.2-24b-instruct` | Mistral / `mistral/eu` |

All **13,230 successful responses** were retained. Disjoint three-response batches produced 35 training and 35 held-out battery observations per model: 105 held-out observations overall. No raw response crossed the training/test boundary.

The classifier was correct on 102/105 held-out observations: 97.14%, with a two-sided 95% Wilson interval of 91.93–99.02%. All three mistakes were **Llama → Mistral**. Llama's observed false-accusation rate was 3/35 (8.57%), but its 95% interval was **2.96–22.38%**. That upper bound exceeds the required 10%; the point accuracy does not override the failed evidence requirement. Intervals are calculated separately, not as simultaneous coverage across families.

Generation used temperature 1 and a 600-token output cap. Truncated outputs were included: 100 Llama and 594 Mistral responses. One Mistral response ended with `tool_calls` and nonempty text; it was retained. These results apply to the listed settings and endpoints, not all models in a family. Provider identity is reported by OpenRouter, not cryptographically attested model weights.

The status file includes plan, dataset, matrix and analysis-source SHA256 digests. The plan predates collection; evaluator hashes were recorded at analysis time, not embedded in the initial plan. The diagnostic report itself contains hashes only. The original raw comparison data are now available in [the lossless archive](data/README.md) for freshness checks; the original billing journal and plan are not part of that archive. Hashes alone are insufficient for independent recomputation. [audit_report.py](audit_report.py) checks complete coverage, response-ID uniqueness, split isolation, ledger agreement, exact matrix reproduction and the unchanged gate when the original artifacts are available.

The experiment is closed. The v3 study above used a separately preregistered abstention rule and fresh data against the existing thresholds. It does not alter or pool this failed experiment. This report does not promote a matrix or enable verdicts.
