# Voirdire

Bonded model declarations and collector-attested behavioural examinations on
GenLayer Bradbury. This is behavioural testimony, **not proof of model identity**.
Bradbury uses testnet GEN; this repository is not a real-money deployment.

- Website: https://voirdire-mu.vercel.app
- Source: https://github.com/Zhekinmaksim/voirdire
- Contract deployment configuration: `public/deployment.json`
- Full contract source: `chain-and-site/contracts/voirdire.py`

## Product flow

1. Connect an EIP-1193 wallet on Bradbury (chain 4221).
2. Register an `openrouter:provider/model-id` agent, its claimed model/version,
   validity dates, challenge stake, premium, bond and immutable collector address.
3. Choose a claim. Prepare six unused corpus probes and download the private plan.
4. Commit the SHA-256 plan digest with the required stake. Wait for finalization.
5. Sign the collection request with the challenger wallet. Supply an OpenRouter
   key for this request; the collector sends it only to OpenRouter and does not
   store it. Provider charges apply to the key supplied by the challenger.
6. Save the returned evidence and collector proof before submitting attestation.
   Attestation can be retried from the saved bundle without buying new responses.
7. After attestation finalizes, reveal the exact evidence. GenLayer produces
   per-class readings. Confirm a pending divergent round, then withdraw credits.

The collector is an explicit trust boundary. It confirms that it obtained these
responses from the registered OpenRouter model endpoint. It cannot prove which
weights the provider ran. Vendor and challenger accept the collector fixed in
that claim; the vendor has no later veto over the evidence.

The application stores plans, evidence and transaction hashes in the browser.
Download backups: clearing browser storage otherwise loses private unrevealed
plans. API keys are never included in those backups.

## Development and checks

Python 3.11+, Node 20+.

```sh
npm ci
make -C chain-and-site test
npm test
npm run build
npm run dev
```

The Vite dev server previews the app. Serverless collector routes run on Vercel;
use the deployed site for that flow or Vercel CLI for local API integration.

```sh
node scripts/chain.mjs read CONTRACT_ADDRESS protocol_info
node scripts/chain.mjs receipt TRANSACTION_HASH
node scripts/chain.mjs trace TRANSACTION_HASH
```

All CLI submissions record hashes immediately in ignored `runs/transactions.jsonl`.
Receipts and diagnostic traces are appended when inspected. A submission is not
success: verify finalization, execution result and resulting contract state.

## Collector deployment

Vercel builds `app/` using the root `vercel.json`. The site and API routes share
`public/deployment.json`. `COLLECTOR_PRIVATE_KEY` is a dedicated, funded Bradbury
signer in Vercel server environment only. Never use a vendor or user wallet as the
hosted collector. Its address must match the deployment config and each claim.

No shared model API key is deployed: each collection uses the challenger's key.
The service accepts fixed corpus prompts, challenger signatures and finalized
commitments only. Its upstream destination is fixed to OpenRouter; user-controlled
URLs cannot receive a key. Collection and on-chain attestation are separate so
paid responses can be saved first.

Sponsorship is bounded by an absolute signer nonce ceiling and a maximum fee per
transaction. The service stops when its allowance is exhausted. See
[`lib/COLLECTOR_OPERATIONS.md`](lib/COLLECTOR_OPERATIONS.md) for renewal and the
remaining cross-instance replay limitation of this testnet service.

Custom domain `voirdire.pro` is managed by the project owner.

## Model calibration

The original matrix leaked raw responses across training and evaluation.
It has been replaced by disjoint batches of three responses: even batches train,
odd batches evaluate. Accuracy and false-accusation confidence bounds are gated.
`k=30` gives only five held-out observations per family. Even with zero errors,
`k=210` is the minimum for the present false-accusation threshold; this is not a
promise that the corpus separates real models.

See `chain-and-site/README.md` for the budget-limited OpenRouter runner. Put
`OPENROUTER_API_KEY` in a local `.env`, never in Git or browser build variables.
Raw responses, costs, generation IDs, models and providers are retained in ignored
run files. Merge explicitly with `merge_runs.py`; do not concatenate headers.

A fixture must produce `UNDECIDABLE` and exit 2. The operational app publishes no
synthetic model scores. `/research/` shows unavailable measurements until a live
matrix passes the gate. Contract testimony and statistical calibration are
separate: a working claim lifecycle does not establish classification accuracy.

## Protocol v2 and recovery

- Commitment covers the probe plan and nonce, not future answers.
- A 24-hour window uses deterministic transaction time, independent of traffic.
- Collector signs the complete response envelope before reveal.
- Other challengers' locked stakes are refunded before a divergent claim pays.
- No collector attestation: expiry releases the challenge stake.
- Attested evidence withheld past expiry: the challenge stake is forfeited.
- Unsettled rounds have a later recovery timeout.
- Closing a claim cannot consume active obligations.

See `chain-and-site/spec/round-envelope.md` for exact rules and canonical bytes.
The initial 21 probes allow three complete six-probe rounds per claim. Exhaustion
is reported explicitly; disclosed probes are never silently reused. Corpus growth
requires new authored probes and fresh calibration, not renamed copies.

## Film

`film/` contains the Remotion project; `voirdire-60s.mp4` is the original film.
Its figures are synthetic historical illustrations, not current product evidence.
It is excluded from deployment. Render with `cd film && npm ci && npm run render`.
