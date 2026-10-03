# Release verification — 3 October 2026

The site is deployed, but **model-identity adjudication is not production-ready**.
This release uses Bradbury test GEN. It must not be represented as a validated
identity oracle or a real-money deployment.

- Application: https://voirdire-mu.vercel.app
- Source: https://github.com/Zhekinmaksim/voirdire
- Active contract: `0x57346Ba266425B31aFC21668CD2829E1dD576A37`
- Exact source and deployment hashes: [deployment.json](public/deployment.json)
- Calibration result: [UNDECIDABLE](chain-and-site/calibration/README.md)

## Verified operation

Real OpenRouter responses were collected by the local collector handler, then
attested by the deployed Vercel collector. On-chain registration, commitment,
attestation, evidence publication and an inconclusive judgement succeeded.
The contract returned the challenge stake as withdrawal credit. This control
used an unclassified declaration; it is not evidence of classification accuracy.

| Step, claim 1 / round 1 | Intelligent Contract transaction |
|---|---|
| Registration | `0xa5ca6c7f996132a333a1961ad6f2d006b0963d5f962780bb8d38294ea7e3764e` |
| Commitment | `0x9f61c0db096c883e82496052751f1b89c1dceddd89d591ae89ba64e830f95fa6` |
| Collector attestation | `0x4a0d5cddc91fd6df13c96757b5131d7eef97a8b487894263c4ae12396b7df18a` |
| Evidence publication | `0xba7671f585c5fd8b306def258ddea64e458a4b64a20bcfe5563ca31e0103333f` |
| Judgement | `0x93bc244214eb7d09f75cde9882fa755c702fd6f07aec45579c16813019941eb7` |
| Withdrawal | `0xaa323ca294b921e130b2e84f6fc9871e5c9fcda81ff16b5f0f84013b97972e4f` |

At 13:24 UTC, withdrawal was ACCEPTED / FINISHED_WITH_RETURN and emitted a
transfer of `1000000000000 wei` to the challenger, with execution on finalization.
The wallet balance had not yet increased. The consensus deadline is 13:48:05 UTC;
this document will only mark payout verified after finalization and an exact
balance increase. A successful execution receipt alone is not a completed payout.

The durable collector journal recovered the existing attestation after an
interrupted response, returning the same transaction without consuming another
signer nonce. Journal writes use private Blob storage, OIDC and conditional
object versions. Signed transactions are persisted before broadcast. Operations,
storage size, sponsored nonce range and transaction fees are bounded. See the
[operator runbook](lib/COLLECTOR_OPERATIONS.md).

## Remaining release blockers

1. **Calibration failed its unchanged evidence gate.** The completed battery has
   13,230 real responses and 105 held-out observations, with no raw response
   overlap between training and evaluation. Accuracy is 102/105, but Llama's
   upper 95% false-accusation bound is 22.38%, exceeding the 10% limit. No approved
   classifier or matrix is published. More calls are not automatically authorized
   as a way to search for a passing result. The [next validation proposal](docs/NEXT_VALIDATION.md)
   specifies the work needed before a new confirmation study; it has not started.
2. **The on-chain judge is a separate, unvalidated decision process.** It does not
   consume the statistical classifier. Real trials have reached disagreement or
   no majority; published evidence then remains pending until recovery. One
   successful inconclusive judgement does not validate decisive identity findings.
3. **Hosted collection and the full wallet UI flow remain unverified.** Real paid
   collection was tested locally, hosted attestation on Vercel, and chain writes
   through the CLI. Browser checks covered the deployed interface and reads.
   Testing a real provider key through hosted `/api/collect` remains pending
   separate authorization for that key transit.
4. **Final native payout verification is pending** the deadline above.

The dedicated collector key is configured in production with the owner's
authorization. The primary wallet key remains local. No shared OpenRouter key is
deployed. Custom domain `voirdire.pro` is managed by the owner.

Conservative model-call debit, including discarded runs and fully reserved
uncertain attempts, is **$2.600286160**: $2.596589260 for the battery and
$0.003696900 for 36 application smoke calls. A separate $0.01 reserve covers the
bounded storage verification, giving **$2.610286160 including that reserve**
against the owner's $9.50 limit. The storage reserve is not an observed invoice.

## Validation and prior trials

The current implementation passed 143 contract checks against both the source
and exact-source deployment wrapper, 35 Python analysis checks and 69 JavaScript
checks. The Vercel build and GitHub CI passed. These checks do not replace live
consensus or empirical model validation.

An earlier contract, `0x28f7Ff5937Bf9Da8c17F1203B9d881DB608D6808`, constructed
an Address from an Address during withdrawal and reverted. The active deployment
fixes that type error. Its predecessor's remaining credit was not recovered;
deploying corrected code does not modify an immutable predecessor.

Other failed network trials and their receipts remain in the local run journals.
They must not be omitted from claims about judge reliability. The original film
contains synthetic historical figures and is excluded from the deployed product.
