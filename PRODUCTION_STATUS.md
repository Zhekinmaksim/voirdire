# Release verification — 3 October 2026

The v3 statistical gate passed. Live economic verification is in progress.
This release uses Bradbury test GEN and a trusted collector. It is not proof
of model identity or a deployment for real-money stakes.

- Application: https://voirdire-mu.vercel.app
- Source: https://github.com/Zhekinmaksim/voirdire
- Active v3 contract: `0xd02C9Ab7C00b10669a3dd04e6d99101bd8eEfE99`
- Profile/manifest/source/deployment bindings: [deployment.json](public/deployment.json)
- Fresh confirmation: [PASS within known scope](chain-and-site/calibration/confirmation-v3/README.md)

## Empirical validation

The preregistered classifier and study were published in Git commit `19df2e6`
before collecting fresh responses. All 1,800 requests completed without retries
or unresolved bills. The fixed sample contains 100 six-response rounds per
model/provider: GPT-4o-mini/OpenAI, Llama 3.3 70B/Groq, Mistral Small 3.2/Mistral EU.
Correct/all counts are 93/100, 95/100 and 94/100. Other outcomes abstained, with
zero observed wrong-family labels. Per-model correct/all lower95 bounds are
86.250%, 88.825%, 87.523%; false-accusation upper95 is 3.699% for each.
The fixed thresholds (75% and10%) and all profile parameters stayed unchanged.

This validates the frozen six-probe classifier within those model/provider
combinations and observation period. It does not certify unknown detection,
model weights, different providers or future endpoint drift. Zero observed
errors is not zero future risk. The original 13,230-response study remains
UNDECIDABLE and is preserved separately. Fresh data, ledger, integrity hashes,
gate source and original compressed comparison data are published for audit.

## Verified deployment and hosted collection

The final contract deployed with AGREE / FINISHED_WITH_RETURN. `protocol_info`
returns version3, APPROVED, the exact profile hash and calibration manifest hash.
The site verifies the public profile bytes against the on-chain hash before
allowing v3 writes. The collector pins providers, versions, prices, temperature,
token limit and termination policy. Inconsistent routing fails closed.

The authorized hosted v3 collection returned six real responses and a proof via
the deployed Vercel endpoint. The browser exercised registration, private plan
backup, commitment, recovery, live hosted collection, evidence backup and
attestation. Its wallet adapter kept the signing key in a local Node process and
allowed only reviewed functions, micro-GEN deposits and bounded fees. The
OpenRouter key was injected in the authorized outbound server request only;
no key entered page state, browser storage, backups or logs. API responses were
real forwarded production responses, not fabricated fixtures.

The durable production collector uses Sensitive environment configuration,
private Blob storage, OIDC, conditional versions and an exclusive signer journal.
Signed transactions are persisted before broadcast; retries recover existing
transactions instead of collecting again or blindly consuming a new nonce.
The signer retains an absolute nonce ceiling of21 and fee limit0.01 test GEN.
The primary wallet key remains local. Custom domain `voirdire.pro` is managed by
the owner. See [operations](lib/COLLECTOR_OPERATIONS.md).

## Live economic controls — native finalization pending

Three separately collected controls passed their expected paths:

- Declared Llama, actual GPT: INCONSISTENT, B1/B2 ADMISSIBLE; full pool and stake
  credited (4e12wei), pool0 and balanced obligations.
- Truthful GPT outside the radius: INCONCLUSIVE, stake1e12wei returned, zero
  confirmed rounds. Its bond remains subject to the original validity window.
- Separate truthful GPT within the radius: CONSISTENT, stake1e12wei returned,
  one confirmed round; vendor closure returned the3e12wei bond.

The browser submitted the combined9e12wei withdrawal. Its Intelligent Contract
transaction was ACCEPTED / AGREE / FINISHED_WITH_RETURN; actual native arrival
must still be verified after Bradbury's finalization window. Public transaction
IDs and the exact credit breakdown are in
[release-verification.json](public/release-verification.json). Every operational
abstention remains recorded separately from the fixed scientific confirmation.

Native payout was independently verified on the preceding v2 release: transaction
`0xaa323ca294b921e130b2e84f6fc9871e5c9fcda81ff16b5f0f84013b97972e4f`
was FINALIZED / FINISHED_WITH_RETURN and increased the recipient wallet by exactly
1e12wei after submission fees. This historical verification is not substituted
for the new v3 economic controls.

## Implementation checks and failed trials

143 archived v2 checks, 30 v3 checks and45 analysis checks pass. All89 JavaScript
checks pass, and the production Vercel build succeeds. The fixture gate still
must return UNDECIDABLE/exit2. Live consensus and actual fund arrival are checked
separately from these offline results.

Two v3 deployment submissions were rejected before execution for excessive gas.
Lossless bz2/base85 packaging and removal of comment prose brought the reviewed
source within the RPC limit; the executable AST and frozen classifier/profile
literals stayed unchanged. Published source preserves the exact deployed bytes,
including residual whitespace; cosmetic edits require a new deployment. A subsequent deployed trial exposed GenVM's inability
to serialize float1.0 from a view. Only the returned generation-policy temperature
was made integer1, with a no-float calldata regression check. The final v3 address
above supersedes that immutable trial at `0x783F194EA2BC28705B3909De5935700F4b7b4d8E`.
Its microscopic test bond remains in the old contract until protocol recovery.

Historical v2 judge disagreements and earlier withdrawal failures remain in
local journals. New deployment does not modify old contracts or move deposits.
The old v2 deployment config is preserved for recovery. The original film has
synthetic historical scores and is excluded from the product deployment.

Current model-call debit is $2.85945606,
including discarded attempts and both hosted trials. A separate $0.02 storage
reserve is not an observed invoice. Both are within the owner's $9.50 limit.
