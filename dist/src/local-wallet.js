import {getAddress} from './vendor/ethers.js';

const loopback = host => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
const roles = ['buyer', 'seller', 'arbiter'];
const names = ['Buyer account', 'Seller account', 'Arbitrator account'];
const reads = new Set(['eth_call', 'eth_estimateGas', 'eth_blockNumber', 'eth_getBlockByNumber',
  'eth_getBlockByHash', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getBalance',
  'eth_getTransactionCount', 'eth_getCode', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory']);

export function localWalletAllowed(network, pageHostname = globalThis.location?.hostname) {
  try {
    const rpc = new URL(network.rpcUrl);
    return loopback(pageHostname) && loopback(rpc.hostname) &&
      ['http:', 'https:'].includes(rpc.protocol) && Number(network.chainId) === 31337;
  } catch { return false; }
}

// Development-only EIP-1193 adapter. The local node signs with its unlocked test accounts.
// No private keys, fabricated transactions, balance top-ups or privileged RPC methods.
export class LocalTestWallet {
  constructor(provider, network, pageHostname) {
    this.provider = provider;
    this.network = {...network};
    this.pageHostname = pageHostname;
    this.account = '';
  }
  async assertLocal() {
    if (!localWalletAllowed(this.network, this.pageHostname))
      throw new Error('Local test wallets are available only on a locally hosted app and chain 31337.');
    if (Number(await this.provider.send('eth_chainId', [])) !== 31337)
      throw new Error('The RPC is not the local test blockchain. No transaction was sent.');
  }
  async accounts() {
    await this.assertLocal();
    const accounts = (await this.provider.send('eth_accounts', [])).slice(0, 3);
    if (accounts.length !== 3) throw new Error('Start the local Hardhat blockchain with its three development accounts.');
    return Promise.all(accounts.map(async (address, index) => ({
      address: getAddress(address), role: roles[index], name: names[index],
      balance: BigInt(await this.provider.send('eth_getBalance', [address, 'latest'])),
    })));
  }
  async select(address) {
    const accounts = await this.accounts();
    const chosen = accounts.find(account => account.address.toLowerCase() === address.toLowerCase());
    if (!chosen) throw new Error('Choose one of the local test accounts.');
    this.account = chosen.address;
    return accounts;
  }
  async request({method, params = []}) {
    await this.assertLocal();
    if (method === 'eth_chainId') return '0x7a69';
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
      const available = await this.provider.send('eth_accounts', []);
      return this.account && available.some(a => a.toLowerCase() === this.account.toLowerCase()) ? [this.account] : [];
    }
    if (method === 'eth_sendTransaction') {
      const tx = params[0];
      if (!this.account || tx?.from?.toLowerCase() !== this.account.toLowerCase())
        throw new Error('The selected local wallet does not match the transaction sender.');
      if (!this.network.address || tx?.to?.toLowerCase() !== this.network.address.toLowerCase())
        throw new Error('Local test wallets can transact only with the configured PactChain contract.');
      if (!(await this.request({method:'eth_accounts'})).length)
        throw new Error('The local account is no longer available. Connect again.');
      return this.provider.send(method, params);
    }
    if (!reads.has(method)) throw new Error(`This request is unavailable in a local test wallet: ${method}`);
    return this.provider.send(method, params);
  }
}
