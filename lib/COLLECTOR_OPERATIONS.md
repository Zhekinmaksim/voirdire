# Collector sponsorship limits

The collector signs only its own zero-value evidence-attestation transactions.
Requests require the challenger's signature over the finalized commitment and a
server HMAC over the collected envelope. An attestation checks both finalized
and provisional chain state before submitting.

These checks protect evidence but do **not** provide distributed idempotency:
two server instances can submit the same proof before either transaction appears
in provisional Intelligent Contract state. Rejected duplicate calls can still
consume the sponsoring account's gas. Per-instance caching and sequential nonce
assignment reduce this race; they do not eliminate it.

The signing boundary therefore requires both production environment variables:

- `COLLECTOR_MAX_NONCE`: exclusive absolute EVM nonce ceiling. A transaction with
  nonce equal to or above this ceiling is refused before signing.
- `COLLECTOR_MAX_TX_FEE_WEI`: maximum `gas × gasPrice` (or EIP-1559 max fee)
  per transaction, in native-token wei. Nonzero value transfers are refused.

No default allowance is granted. Missing or malformed limits disable collection
and attestation until an operator configures them. Never automatically raise
these limits in response to requests.

For example, pending nonce 1, ceiling 21, and fee limit 10000000000000000 wei
permit at most 20 additional mined sponsored transactions, each capped at
0.01 GEN, for a total bound of 0.2 GEN. Concurrent calls and deployment restarts
cannot increase that bound because nonce consumption is enforced by Ethereum.
This assumes the signing key is used only by this bounded collector; direct
operator transactions use their own authorization and may consume its nonce range.

When exhausted, inspect receipts and account nonce, identify duplicate/error
traffic, then deliberately set a new small allowance and redeploy. Do not refill
the wallet or raise the ceiling as an automatic response to an API error.

For unattended public production, use a durable global queue/idempotency record
and monitoring. The current implementation is a bounded sponsored testnet
service, with request failures possible during cross-instance nonce races.

Provider keys arrive only in `/api/collect`, are sent to the fixed OpenRouter
HTTPS destination without redirects, and are not retained or logged. Evidence
bundles and transaction hashes contain no provider keys. Clients must save the
returned envelope and proof before requesting attestation; a failed collection
can already have incurred charges at the user's model provider.

## Superseded network trial

The initial contract `0xd6B2c2d31f48552341493DA1fcF772F5486f4454` is not the
replacement contract with divergence-only referees. Its reveal transaction
`0x008a8c18572a313ba06e4c75ced3089fa550eb2d8ded4562a37e35b999a9d7d1`
returned a leader result but reached UNDETERMINED / DISAGREE after appeals during
the live trial. That is not a successful adjudication. The trace did not expose
individual validator reasoning. Do not submit a duplicate while appeals or
recomputation remain active.

Funds in that original claim are separate from any replacement deployment.
Check its actual commitment and claim views before recovery. An attested,
unrevealed commitment's 24-hour expiry forfeits the stake to the original claim
pool; it does not automatically refund the challenger. A vendor's closure is
subject to the claim's validity window and remaining obligations.

The revised contract runs divergence referees only for an INCONSISTENT result.
CONSISTENT and INCONCLUSIVE have `NOT_REQUIRED` referee stages and return stake;
only CONSISTENT increments confirmed rounds. Validators independently repeat
each model judgment and compare the decision enum/boolean in code. Genuine
judgment disagreement still prevents acceptance.

## Guarded finalization

Use `node scripts/chain.mjs can-finalize HASH` to inspect readiness using the
latest block's timestamp and the deployed consensus `canFinalize` view. This
command reads only; it logs the deadline and current consensus/execution result.

Only after readiness is true, `node scripts/chain.mjs finalize HASH` can send a
finalization transaction. It checks readiness again, requires successful gas
estimation, signs once, records the EVM receipt, and then reads the Intelligent
Contract receipt. Estimation failure aborts without signing; a mined revert is
reported without automatic retry. An ACCEPTED receipt is provisional, not final.

Verification of the current implementation: 121 contract state-machine checks
also pass against the exact-source deployment wrapper. JavaScript tests cover
12 collector cases, four finalization safety cases, and seven browser protocol
cases (23 total). These are automated logic tests; successful deployment and
live consensus adjudication require separate network receipts.
