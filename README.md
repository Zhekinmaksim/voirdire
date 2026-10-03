# Voirdire

Bonded model declarations and collector-attested behavioural examinations on
GenLayer Bradbury. This is behavioural testimony, **not proof of model identity**.
Bradbury uses testnet GEN; this repository is not a real-money deployment.

- Website: https://voirdire-mu.vercel.app
- Working application: https://voirdire-mu.vercel.app/app/
- Source: https://github.com/Zhekinmaksim/voirdire
- Contract deployment configuration: `public/deployment.json`
- Full contract source: `chain-and-site/contracts/voirdire.py`
- Verified release boundaries: [PRODUCTION_STATUS.md](PRODUCTION_STATUS.md)
- Live v3 controls and finalized native payout: [release-verification.json](public/release-verification.json)

The main page restores the original obsidian, brushed-metal and interference-film
design. Its table shows the fresh v3 confirmation counts, not fixture separation
scores. The working registry is at `/app/` in the same visual system; research
and release evidence remain at their existing URLs. The landing page is generated
from `app/home.tpl.html` only after the release bindings pass `prepare_web.py`.

## Product flow

1. Connect an EIP-1193 wallet on Bradbury (chain 4221).
2. Register an `openrouter:provider/model-id` agent, its claimed model/version,
   validity dates, challenge stake, premium, bond and immutable collector address.
3. Choose a claim. Prepare the six frozen v3 probes and download the private plan.
4. Commit the SHA-256 plan digest with the required stake. Wait for finalization.
5. Sign the collection request with the challenger wallet. Supply an OpenRouter
   key for this request; the collector sends it only to OpenRouter and does not
   store it. Provider charges apply to the key supplied by the challenger.
6. Save the returned evidence and collector proof before submitting attestation.
   Attestation can be retried from the saved bundle without buying new responses.
7. After attestation finalizes, publish the exact evidence. This deterministic
   step records the responses and burns the probes without asking an LLM.
8. Request judgement on the published round. The deterministic integer classifier
   compares the complete six-response round with the frozen profile. Matching
   results return the stake; abstention remains inconclusive. Divergent results
   require separate B1/B2 referee consensus before credits can be withdrawn.
   If validators do not agree, the evidence remains public and the round stays
   pending; it is not counted as an examination. The recovery timeout still
   releases its stake according to the protocol.

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
transaction. A private journal persists signed transactions before broadcast and
deduplicates requests across server instances and restarts. It uses Vercel OIDC
and the nonsecret production `BLOB_STORE_ID`; no provider key or private signing
key is stored in the journal. The service stops when its allowance or journal
capacity is exhausted. See [`lib/COLLECTOR_OPERATIONS.md`](lib/COLLECTOR_OPERATIONS.md)
for recovery and renewal.

Custom domain `voirdire.pro` is managed by the project owner.

## Calibrated v3 scope

A preregistered fresh confirmation completed 1,800 real responses: 100 independent
six-response rounds for each pinned model/provider. The unchanged gate returned
PASS. Correct/all was 93/100 for GPT-4o-mini (OpenAI), 95/100 for Llama 3.3 70B
(Groq), and 94/100 for Mistral Small 3.2 (Mistral EU). Every other result abstained;
there were no observed wrong-family labels. Per-model correct/all Wilson 95%
lower bounds exceed 75%; wrong-label upper bounds are 3.699%, below 10%.
Zero observed errors does not establish zero future risk.

The classifier was frozen and published in Git before collecting confirmation
responses. It was not fitted on them. Exact prompts, features, provider routes,
integer parameters and the capped-output policy are bound by the release manifest.
See [confirmation data](chain-and-site/calibration/confirmation-v3/README.md),
[gate](chain-and-site/calibration/confirmation-v3/gate.json) and
[frozen release](chain-and-site/calibration/candidates/int-v3/manifest.json).

This release supports those three exact model/provider combinations only, one
complete six-probe round per claim, temperature 1 and at most 600 output tokens.
`stop` and `length` outputs are in scope; capped fragments remain partial.
Unknown models, different providers, model weights and future endpoint drift have
not been certified. Do not interpret a result as proof of identity.

The original 13,230-response battery remains UNDECIDABLE; its Llama false-accusation
confidence bound failed. It is preserved separately and has not been pooled with
or relabelled by v3. Synthetic fixtures still must return UNDECIDABLE / exit 2.
The historical v2 implementation and its 143 checks remain archived for recovery.

## Protocol v3 and recovery

- Commitment binds the frozen profile, exact probe plan and nonce before answers.
- The 24-hour window uses deterministic transaction time, independent of traffic.
- The immutable collector attests exact responses and termination metadata.
- Publishing evidence spends the six probes; the same claim cannot reuse them.
- Matching and abstaining rounds return stakes; only matching rounds count.
- Divergence requires B1 and B2 consensus. A confirmed finding pays the entire
  remaining pool after refunding other challengers' locked stakes.
- Collector failure releases stake at expiry. Attested evidence withheld beyond
  expiry forfeits stake, except when another publication consumed the fixed set.
- Unsettled referee rounds release stake after their recovery timeout.
- Closing cannot consume active obligations. Withdrawals pay on finalization.

V2 recovery uses [the prior deployment](public/deployment-v2.json). Contracts and
claims are immutable; changing the site address does not move old deposits.

## Film

`film/` contains the updated Remotion project; `voirdire-60s.mp4` is the current
60-second v3 cut. It presents the real confirmation counts, trusted collector,
three finalized controls and verified withdrawal of testnet GEN. The original
design and music edit remain; Geist fonts are now bundled. The earlier synthetic
cut is archived in Git history.

The complete new MP4 was rendered and decoded successfully. See
[film/AUDIT.md](film/AUDIT.md) and [film/RELEASE.json](film/RELEASE.json) for the
checks and artifact hashes. The video is a repository/local release artifact,
excluded from Vercel deployment. Render with `cd film && npm ci && npm run render`;
the film's displayed facts are validated against the product release first.
The full composition was re-rendered and decoded successfully during the current
review; see [film/AUDIT.md](film/AUDIT.md) for outdated captions and font fallback
limitations that must be addressed before a current launch cut.
