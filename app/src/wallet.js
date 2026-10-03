// Persist the EVM hash before the SDK waits for a receipt and resolves an IC ID.
// Bind forwarded methods to the original provider (some wallets require `this`).
export function trackWalletProvider(provider, onSubmitted) {
  return new Proxy(Object.create(null), {
    get(_target, property) {
      const target = provider;
      if (property === 'request') return async function (request) {
        if (request.method === 'eth_sendTransaction' && request.params?.[0]?.gas !== undefined) {
          const transaction = request.params[0], gas = BigInt(transaction.gas);
          if (gas <= 0n) throw new Error('A positive gas estimate is required.');
          // Consensus submission cost can change between estimation and mining.
          // The padded limit is shown in the wallet before the user approves.
          request = { ...request, params: [{ ...transaction,
            gas: '0x' + ((gas * 125n + 99n) / 100n).toString(16),
          }, ...request.params.slice(1)] };
        }
        const result = await target.request.call(target, request);
        if (request.method === 'eth_sendTransaction' && typeof result === 'string' && /^0x[0-9a-f]{64}$/i.test(result)) {
          onSubmitted(result);
        }
        return result;
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    has(_target, property) { return property in provider; },
  });
}
