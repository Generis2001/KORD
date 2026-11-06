import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Account, JsonRpcProvider, KeyPair, actions, teraToGas } from 'near-api-js';
import type { KeyPairString } from 'near-api-js';
import { loadNearConfig, assertTestnet } from '../src/near.js';
import { units, confirmedHash, validAccount } from '../src/agent-wallet.js';
import { TEST_USDT_TOKEN_ID } from '../src/swap.js';

const cfg = loadNearConfig(); assertTestnet(cfg);
const contractId = process.env.USDT_STAKING_CONTRACT_ID || `usdt.${cfg.accountId}`;
if (!validAccount(contractId) || !contractId.endsWith(`.${cfg.accountId}`)) throw new Error('Use a new Test USDT staking subaccount beneath NEAR_ACCOUNT_ID.');
const provider = new JsonRpcProvider({ url: cfg.rpcUrl });
const account = new Account(cfg.accountId, provider, cfg.privateKey as KeyPairString);
const key = KeyPair.fromString(cfg.privateKey as KeyPairString);
const wasm = await readFile('staking-contract/target/wasm32-unknown-unknown/release/kord_testnet_staking.wasm');
if (process.argv.includes('--redeploy')) {
  const contract = new Account(contractId, provider, cfg.privateKey as KeyPairString);
  const result = await contract.signAndSendTransaction({ receiverId: contractId, actions: [actions.deployContract(wasm)] });
  console.log(JSON.stringify({ contractId, transaction: `https://testnet.nearblocks.io/txns/${confirmedHash(result)}` }, null, 2));
  process.exit(0);
}
// Cover bytecode/state storage and leave a funded operating reserve for positions.
const deposit = BigInt(wasm.length + 50_000) * 10n ** 19n + units('0.1', 24);
const result = await account.signAndSendTransaction({ receiverId: contractId, actions: [actions.createAccount(), actions.transfer(deposit), actions.addFullAccessKey(key.getPublicKey()), actions.deployContract(wasm), actions.functionCall('new', { token_id: TEST_USDT_TOKEN_ID, cooldown_seconds: 60 }, teraToGas('50'), 0n)] });
console.log(JSON.stringify({ contractId, tokenId: TEST_USDT_TOKEN_ID, cooldownSeconds: 60, transaction: `https://testnet.nearblocks.io/txns/${confirmedHash(result)}` }, null, 2));
