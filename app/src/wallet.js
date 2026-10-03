// Persist the EVM hash before the SDK waits for a receipt and resolves an IC ID.
// Bind forwarded methods to the original provider (some wallets require `this`).
export function trackWalletProvider(provider, onSubmitted) {
  return new Proxy(Object.create(null), {
    get(_target, property) {
      const target = provider;
      if (property === 'request') return async function (request) {
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
