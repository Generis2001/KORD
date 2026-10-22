import "dotenv/config";
import { Account, JsonRpcProvider, teraToGas } from "near-api-js";
import type { KeyPairString } from "near-api-js";
import { assertTestnet, loadNearConfig } from "../src/near.js";

/**
 * Owner (treasury) creates and funds the onchain mandate used by `DEMO_EXECUTOR=escrow npm run demo`.
 * Budget $20.00 = 2000 cents, per-agent cap $5.00 = 500 cents, mapped to NEAR via YOCTO_PER_CENT.
 * Usage: npm run escrow:setup            (MANDATE_ID defaults to demo-1)
 */
const cfg = loadNearConfig();
assertTestnet(cfg);
const contractId = process.env.ESCROW_CONTRACT_ID;
const verifier = process.env.VERIFIER_ACCOUNT_ID;
const agents = [process.env.AGENT_RESEARCHER, process.env.AGENT_ANALYST];
if (!contractId || !verifier || agents.some((a) => !a)) throw new Error("Set ESCROW_CONTRACT_ID, VERIFIER_ACCOUNT_ID, AGENT_RESEARCHER, AGENT_ANALYST in .env");

const owner = new Account(cfg.accountId, new JsonRpcProvider({ url: cfg.rpcUrl }), cfg.privateKey as KeyPairString);
const budget = 2000n * cfg.yoctoPerCent;
const cap = 500n * cfg.yoctoPerCent;
const res: any = await owner.callFunctionRaw({
  contractId,
  methodName: "create_mandate",
  args: { mandate_id: process.env.MANDATE_ID ?? "demo-1", verifier, per_agent_cap: cap.toString(), allowed_agents: agents },
  gas: teraToGas("30"),
  deposit: budget,
});
console.log(`create_mandate sent. tx: ${res?.transaction?.hash}`);
console.log(`Explorer: https://explorer.testnet.near.org/transactions/${res?.transaction?.hash}`);
