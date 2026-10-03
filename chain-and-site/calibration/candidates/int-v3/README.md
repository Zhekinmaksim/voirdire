# Frozen integer v3 — fresh confirmation pending

**GO only to collect the preregistered known-scope confirmation. Not approved for payouts or unknown-family identity claims.** The old battery result remains UNDECIDABLE.

This distinct candidate measures actual provider responses capped at600 tokens. It explicitly accepts `stop` and `length` finish reasons, retains the returned text without inventing a completion, and rejects empty/tool/error outputs. A round with any invalid response or response longer than4096 characters abstains. The prior stop-only proposal failed development coverage catastrophically for Mistral and was not collected as a fresh study. The capped-response policy was changed and frozen before any fresh calls; evidence thresholds were not relaxed.

The exact six probes, prompts, standardized features, centroids and training95th-percentile radii are bound by `profile.json`. Runtime scoring uses scale1,000,000 integers, fixed40-term logarithm approximation and squared distances. The315 old development decisions matched the float candidate before quality checks; maximum single-feature discrepancy was below0.000001. Under this v3 quality policy, old development correct/all counts are GPT95/105, Llama103/105, Mistral95/105; all other outcomes abstain, with zero wrong labels. Correct/all lower95 bounds are83.35%,93.32%,83.35%. These consumed development results cannot serve as confirmation.

`manifest.json` binds classifier/profile, plan, prices, development report, gate and runner sources. Do not regenerate or edit them after collection starts. Approval is separate from the immutable profile. A contract implementation must reproduce the exact decisions and authenticate the same finish-reason/evidence policy before it can use a separately approved release.

The fixed plan requests100 independent six-response rounds for each of three pinned model/provider routes:1,800 responses. No fitting or model selection occurs on these data. Each family's correct/all Wilson95 lower bound must be at least0.75 and wrong-label Wilson95 upper bound at most0.10. Abstentions stay in the denominator. Complete all100 per family before inspecting outcomes; no optional extension to obtain PASS. No fresh upstream ID may appear in the original dataset.

Public endpoint quotes match the frozen prices and status0. The byte-based estimate is$0.803616; the cumulative fresh budget is$2.00, including conservative full-reservation charges for failed attempts. The existing supervisor permits at most8 HTTP429 recoveries, at mostone per logical identity, with at least60 seconds cooldown or longer Retry-After. Other failures stop. The new `--max-identity-retries` runner flag preserves the old default2 but must be1 for this plan.

After the immutable files have been published, the root operator may start the authorized collection using a new directory:

```sh
python3 chain-and-site/scripts/openrouter_battery.py supervise \
  --plan chain-and-site/calibration/candidates/int-v3/confirmation-plan.json \
  --out chain-and-site/runs/round-int-v3-fresh \
  --budget 2.00 --concurrency 9 --min-interval 1.2 \
  --max-retries 8 --max-identity-retries 1 --cooldown 60
```

Only after completion and reconciliation:

```sh
python3 chain-and-site/scripts/round_confirmation_gate.py \
  --release chain-and-site/calibration/candidates/int-v3 \
  --run-dir chain-and-site/runs/round-int-v3-fresh \
  --old-source chain-and-site/runs/openrouter-groq-merged.jsonl \
  --out chain-and-site/runs/round-int-v3-fresh/gate.json
```

The gate verifies raw/ledger equality, frozen hashes, full coverage, model/provider receipts, unique new response IDs, closed spending and recovery records, then applies the fixed integer classifier and quality policy. An incomplete or altered study returns INVALID/exit2; insufficient bounds return UNDECIDABLE/exit2. PASS concerns only the specified known model/provider combinations and observation period. It does not validate unknown detection or approve economic settlement automatically.
