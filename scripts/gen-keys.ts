import { KeyPair } from "near-api-js";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";

/**
 * Generates fresh testnet keypairs LOCALLY. Secret keys are written to .secrets/keys.json (mode 600)
 * and to .env (treasury + verifier only, if .env does not exist). Secrets are never printed.
 *
 * Usage: npm run gen-keys -- <prefix>
 * Example: npm run gen-keys -- kord-gen   ->  kord-gen-treasury.testnet, ...
 * Then create each printed account (see README) using its printed PUBLIC key, and fund the treasury.
 */
const prefix = process.argv[2];
if (!prefix || !/^[a-z0-9-]{3,30}$/.test(prefix)) throw new Error("Usage: npm run gen-keys -- <prefix>  (lowercase letters, digits, dashes)");

const roles = ["treasury", "verifier", "researcher", "analyst", "escrow"] as const;
type Entry = { accountId: string; publicKey: string; secretKey: string };
const keys = {} as Record<(typeof roles)[number], Entry>;
for (const r of roles) {
  const kp = KeyPair.fromRandom("ed25519");
  keys[r] = { accountId: `${prefix}-${r}.testnet`, publicKey: kp.getPublicKey().toString(), secretKey: kp.toString() };
}

mkdirSync(".secrets", { recursive: true });
writeFileSync(".secrets/keys.json", JSON.stringify(keys, null, 2), { mode: 0o600 });
chmodSync(".secrets/keys.json", 0o600);

if (!existsSync(".env")) {
  const k = keys;
  writeFileSync(
    ".env",
    [
      "NEAR_NETWORK=testnet",
      "NEAR_RPC_URL=https://test.rpc.fastnear.com",
      `NEAR_ACCOUNT_ID=${k.treasury.accountId}`,
      `NEAR_PRIVATE_KEY=${k.treasury.secretKey}`,
      `AGENT_RESEARCHER=${k.researcher.accountId}`,
      `AGENT_ANALYST=${k.analyst.accountId}`,
      `AGENT_VERIFIER=${k.verifier.accountId}`,
      `ESCROW_CONTRACT_ID=${k.escrow.accountId}`,
      `VERIFIER_ACCOUNT_ID=${k.verifier.accountId}`,
      `VERIFIER_PRIVATE_KEY=${k.verifier.secretKey}`,
      "YOCTO_PER_CENT=1000000000000000000000",
      "KORD_DB=kord.db",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  console.log("Wrote .env (mode 600).");
} else {
  console.log(".env already exists; left unchanged. Secrets are in .secrets/keys.json.");
}

console.log("\nCreate these TESTNET accounts with the public keys below (never share secret keys):\n");
for (const r of roles) console.log(`${r.padEnd(10)} ${keys[r].accountId}\n           ${keys[r].publicKey}`);
console.log("\nNote: the verifier is both the escrow approver and the 'verifier' agent account only in this demo layout;");
console.log("the contract forbids the verifier from being a paid agent, so escrow mode pays researcher and analyst only.");
