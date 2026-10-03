import { readFileSync, appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createClient, createAccount } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';
import { encodeFunctionData, decodeFunctionResult, createPublicClient, http, keccak256 } from 'viem';

export const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
export function record(event) {
  mkdirSync('runs', { recursive: true });
  appendFileSync('runs/transactions.jsonl', json({ at: new Date().toISOString(), ...event }) + '\n', { mode: 0o600 });
}
export function auditedAccount(account, log = record) {
  return { ...account, async signTransaction(request, ...rest) {
    const serialized = await account.signTransaction(request, ...rest);
    // Persist the public hash before the SDK broadcasts. Never log signing
    // material or the serialized transaction, including on later SDK failure.
    log({ event: 'evm_signed', evmHash: keccak256(serialized),
      from: account.address, to: request.to, nonce: request.nonce,
      value: request.value, gas: request.gas, gasPrice: request.gasPrice,
      maxFeePerGas: request.maxFeePerGas });
    return serialized;
  } };
}
export async function client(signer = false) {
  let account;
  if (signer) {
    let key = process.env.GENLAYER_PRIVATE_KEY;
    if (!key) {
      const config = JSON.parse(readFileSync(join(homedir(), '.genlayer/genlayer-config.json'), 'utf8'));
      const cli = realpathSync(execFileSync('which', ['genlayer'], { encoding: 'utf8' }).trim());
      const keytar = (await import(pathToFileURL(resolve(dirname(cli), '../node_modules/keytar/lib/keytar.js')))).default;
      key = await keytar.getPassword('genlayer-cli', 'account:' + config.activeAccount);
    }
    if (!key) throw new Error('Unlock the GenLayer CLI account; no signing key is available.');
    account = auditedAccount(createAccount(key));
  }
  return createClient({ chain: testnetBradbury, account, endpoint: process.env.GENLAYER_RPC_URL || undefined });
}
export async function inspect(c, hash) {
  const receipt = await c.getTransaction({ hash });
  record({ event: 'receipt', hash, receipt });
  return receipt;
}
export async function submit(c, request, deploy = false) {
  record({ event: 'intent', method: deploy ? 'deploy' : request.functionName, address: request.address });
  const hash = deploy ? await c.deployContract(request) : await c.writeContract(request);
  record({ event: 'submitted', hash, method: deploy ? 'deploy' : request.functionName });
  console.log(json({ hash }));
  return hash;
}

export async function canFinalize(c, hash, log = record) {
  if (!/^0x[0-9a-f]{64}$/i.test(hash || '')) throw new Error('A 32-byte transaction hash is required');
  const block = await c.request({ method: 'eth_getBlockByNumber', params: ['latest', false] });
  const currentTimestamp = BigInt(block.timestamp);
  const contract = c.chain.consensusDataContract;
  const data = encodeFunctionData({ abi: contract.abi, functionName: 'canFinalize', args: [hash, currentTimestamp] });
  const raw = await c.request({ method: 'eth_call', params: [{ to: contract.address, data }, 'latest'] });
  const [ready, checkedAt, finalizeAfter] = decodeFunctionResult({ abi: contract.abi, functionName: 'canFinalize', data: raw });
  const receipt = await c.getTransaction({ hash });
  const state = { hash, canFinalize: ready, currentTimestamp: checkedAt, finalizeAfter,
    secondsRemaining: finalizeAfter > currentTimestamp ? finalizeAfter - currentTimestamp : 0n,
    status: receipt.statusName || receipt.status, result: receipt.resultName, execution: receipt.txExecutionResultName };
  log({ event: 'finalization_readiness', ...state });
  return state;
}

export async function finalize(c, hash, { log = record, waitForReceipt } = {}) {
  const state = await canFinalize(c, hash, log);
  if (!state.canFinalize) throw new Error(`Transaction is not ready to finalize; ${state.secondsRemaining} seconds until the reported deadline. No transaction sent.`);
  if (!c.account?.signTransaction) throw new Error('A local signing account is required');
  const contract = c.chain.consensusMainContract;
  const data = encodeFunctionData({ abi: contract.abi, functionName: 'finalizeTransaction', args: [hash] });
  // Estimation errors must abort. Never use the SDK/CLI's fallback gas path.
  const gas = BigInt(await c.request({ method: 'eth_estimateGas', params: [{ from: c.account.address, to: contract.address, data, value: '0x0' }] }));
  if (gas <= 0n) throw new Error('Finalization gas estimate was invalid; no transaction sent');
  const nonce = await c.getCurrentNonce({ address: c.account.address, block: 'pending' });
  const gasPrice = BigInt(await c.request({ method: 'eth_gasPrice' }));
  log({ event: 'finalization_intent', hash, gas, gasPrice, nonce });
  const serializedTransaction = await c.account.signTransaction({ account: c.account, to: contract.address,
    data, type: 'legacy', nonce: Number(nonce), value: 0n, gas, gasPrice, chainId: c.chain.id });
  const evmHash = await c.sendRawTransaction({ serializedTransaction });
  log({ event: 'finalization_submitted', hash, evmHash });
  const wait = waitForReceipt || (request => createPublicClient({ chain: c.chain,
    transport: http(process.env.GENLAYER_RPC_URL || undefined) }).waitForTransactionReceipt(request));
  const evmReceipt = await wait({ hash: evmHash });
  log({ event: 'finalization_evm_receipt', hash, evmHash, receipt: evmReceipt });
  if (evmReceipt.status !== 'success') throw new Error(`Finalization EVM transaction reverted: ${evmHash}. No automatic retry.`);
  const receipt = await c.getTransaction({ hash });
  log({ event: 'receipt', hash, receipt });
  return { hash, evmHash, status: receipt.statusName || receipt.status,
    result: receipt.resultName, execution: receipt.txExecutionResultName };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  try {
    const c = await client(['deploy', 'write', 'finalize'].includes(command));
    if (command === 'deploy') {
      await submit(c, { code: readFileSync(args[0] || 'public/voirdire.deploy.py', 'utf8'), args: [] }, true);
    } else if (command === 'can-finalize') {
      console.log(json(await canFinalize(c, args[0])));
    } else if (command === 'finalize') {
      console.log(json(await finalize(c, args[0])));
    } else if (command === 'read') {
      console.log(json(await c.readContract({ address: args[0], functionName: args[1], args: JSON.parse(args[2] || '[]'), transactionHashVariant: 'latest-final' })));
    } else if (command === 'receipt') {
      const receipt = await inspect(c, args[0]);
      console.log(json({ hash: args[0], status: receipt.statusName || receipt.status,
        result: receipt.resultName, execution: receipt.txExecutionResultName,
        recipient: receipt.recipient, createdTimestamp: receipt.createdTimestamp,
        lastVoteTimestamp: receipt.lastVoteTimestamp, currentTimestamp: receipt.currentTimestamp }));
    } else if (command === 'trace') {
      const trace = await c.debugTraceTransaction({ hash: args[0] });
      record({ event: 'trace', hash: args[0], trace });
      console.log(json(trace));
    } else if (command === 'schema') {
      console.log(json(await c.getContractSchemaForCode(readFileSync(args[0] || 'public/voirdire.deploy.py', 'utf8'))));
    } else if (command === 'write') {
      const input = JSON.parse(readFileSync(args[0], 'utf8'));
      await submit(c, { ...input, value: BigInt(input.value || 0) });
    } else throw new Error('Use deploy | schema | read ADDRESS METHOD [ARGS_JSON] | receipt HASH | trace HASH | write REQUEST_FILE | can-finalize HASH | finalize HASH');
  } catch (error) {
    record({ event: 'error', command, error: error.message });
    console.error(error.message);
    process.exitCode = 1;
  }
}
