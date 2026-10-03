# Fresh v3 confirmation — PASS, limited known scope

Published preregistration: Git commit `19df2e6`, before any confirmation calls.
Frozen inputs are in `../candidates/int-v3/`; do not modify them. Their original
manifest deliberately says FROZEN_UNVALIDATED. Approval is a separate compiled
contract flag and this independent report; the original manifest was not edited.

The completed sample has 1,800 real responses, grouped into 100 six-response
rounds per model. Raw JSONL files and the full billing ledger are included.
`release.json` binds these files and records observation timestamps. No model
key, signing key or signed transaction is present. All 1,800 upstream IDs are
unique and absent from the old dataset. No retries or unresolved bills occurred.
Conservative model-call debit: $0.25668290.

| Pinned model / provider | Correct / all | Abstained | Wrong family |
|---|---:|---:|---:|
| GPT-4o-mini / OpenAI | 93/100 | 7 | 0 |
| Llama 3.3 70B / Groq | 95/100 | 5 | 0 |
| Mistral Small 3.2 / Mistral EU | 94/100 | 6 | 0 |

The fixed correct/all lower95 threshold is 0.75, false-accusation upper95 is 0.10.
Abstentions stay in the denominator. Wilson bounds and the confusion matrix are
in `gate.json`. No fitting, optional extension or parameter adjustment used these
data. This is a distinct method from the earlier UNDECIDABLE matrix.

The gate can be reproduced using the published archive (see `../data/README.md`):

```sh
python3 chain-and-site/scripts/round_confirmation_gate.py \
  --release chain-and-site/calibration/candidates/int-v3 \
  --run-dir chain-and-site/calibration/confirmation-v3 \
  --old-source /tmp/voirdire-old.jsonl \
  --out /tmp/voirdire-v3-audit.json
```

The old comparison dataset is required to recheck freshness, not to fit or score
this confirmation sample. Its lossless archive is published in `../data/`. Its SHA-256 is pinned in the immutable manifest.
This PASS concerns only the three specified model/provider combinations and the
observation period. It does not certify unknown detection, prove model weights,
or independently approve economic settlement. Real B1/B2 and withdrawals must
be checked on chain separately.
