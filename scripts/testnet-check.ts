import "dotenv/config";
import { NearExecutor, getExplorerTxUrl, loadNearConfig } from "../src/near.js";

/**
 * Usage:
 *   npm run testnet:check                       # prints treasury balance (read only)
 *   npm run testnet:check -- --send agent.testnet 1   # sends 1 logical cent worth of NEAR
 */
const cfg = loadNearConfig();
const exec = new NearExecutor(cfg);
console.log(`Network: ${cfg.network}\nRPC: ${cfg.rpcUrl}\nTreasury: ${cfg.accountId}`);
console.log(`Balance: ${await exec.balanceNear()} NEAR`);

const i = process.argv.indexOf("--send");
if (i !== -1) {
  const recipient = process.argv[i + 1];
  const cents = BigInt(process.argv[i + 2] ?? "1");
  if (!recipient) throw new Error("Usage: --send <recipient> <cents>");
  const r = await exec.execute({ recipient, amountCents: cents, mandateId: "manual-check", taskId: "manual-check", evidenceHash: "n/a" });
  console.log(`Sent. tx hash: ${r.txHash}`);
  console.log(`Explorer: ${getExplorerTxUrl(cfg.network, r.txHash!)}`);
}
