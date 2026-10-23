# Mandate

An autonomous business agent that delegates work, pays for verified deliverables, and enforces user-defined spending limits on NEAR.

**Security model:** agents and models can only *propose* a payment. A deterministic policy engine authorizes it, the budget is reserved atomically in SQLite, and only then does the treasury execute a NEAR transfer. Agents never touch the signing key.

**Honest scope:** the TypeScript app enforces limits in backend code (`src/policy.ts`, `src/treasury.ts`). `contract/` holds a Rust escrow that enforces the same limits onchain, and `DEMO_EXECUTOR=escrow` routes payments through it. Neither the contract nor the escrow path has been deployed or run on testnet yet. Verification is rule-based, not model-based. Money is tracked as integer "logical cents"; on testnet they map to NEAR at a configurable demo rate (`YOCTO_PER_CENT`).

## Run (no network, mock executor)

```bash
npm install
npm test          # 16 tests: policy rules, atomic budget, failure handling
npm run demo      # mock mode: clearly labeled, onchain=false, no tx hash
```

## Run on NEAR testnet (you run these on your machine)

Nothing below has been run against the real network yet. Secret keys stay on your machine: `gen-keys` never prints them.

1. `npm run gen-keys -- <prefix>` writes `.env` and `.secrets/keys.json` (mode 600) and prints five testnet account ids with their PUBLIC keys.
2. Create those five accounts on testnet with the printed public keys, using the current method in https://docs.near.org/, and fund the treasury with testnet NEAR.
3. Read-only check: `npm run testnet:check`
4. One tiny real transfer: `npm run testnet:check -- --send <researcher>.testnet 1`
5. Plain-transfer demo: `DEMO_EXECUTOR=near npm run demo`
6. Escrow demo: build and deploy `contract/` to the escrow account and call `new` (see `contract/README.md`), then `npm run escrow:setup`, then `DEMO_EXECUTOR=escrow npm run demo`
7. Run the checks in `contract/README.md` (including calling `on_payout` from another account, which must fail).
8. Open every printed tx hash in the testnet explorer and confirm it.

In escrow mode a payment is recorded as confirmed only if the contract emitted `payment_confirmed`; the verifier key can only call `approve_payment`.

## Mainnet Support & Safety Protocol

Mandate defaults to **testnet** to prevent accidental fund loss. To enable **mainnet** execution, strict multi-layered safety controls must be explicitly satisfied:

1. **Network Toggle:** Set `NEAR_NETWORK=mainnet` in `.env`.
2. **Explicit Opt-In Switch:** Set `ALLOW_MAINNET=true`.
3. **Safety Confirmation Phrase:** Set `MAINNET_CONFIRMATION=I_CONFIRM_SPENDING_REAL_FUNDS`.
4. **Hard Spending Ceilings:**
   - `MAINNET_MAX_PAYMENT_CENTS`: Hard limit on single payouts (default: 5,000 cents = $50.00). Transactions exceeding this ceiling are rejected locally before reaching RPC.
   - `MAINNET_MAX_TOTAL_BUDGET_CENTS`: Hard cap on cumulative mandate budget (default: 20,000 cents = $200.00).
5. **Account & RPC Isolation:** The app strictly validates that `.testnet` accounts and testnet RPCs cannot be used on mainnet, and vice versa.

## Agent Swap & Payout (NEAR Testnet)

Mandate includes an autonomous **Agent Swap & Payout** capability that allows users to allocate testnet NEAR to an authorized agent, execute an on-chain exchange for Mandate Test USDT (`usdt.fakes.testnet`), and disburse the resulting tokens directly into any designated NEAR testnet wallet.

### Security Controls & Architecture:
- **Controlled Autonomy:** Deterministic TypeScript policies validate allocations, single-swap caps (max 20 NEAR per swap), and minimum output amounts before any transaction is signed.
- **NEP-141 / NEP-145 Standards:** Automatic storage registration (`storage_deposit`) ensures recipient accounts can receive fungible tokens without manual setup.
- **Demonstration Exchange Rate:** 1 NEAR = 5.00 Test USDT (clearly flagged as a development demonstration rate, not a real-world market quote).
- **Development Asset Notice:** Mandate Test USDT (`usdt.fakes.testnet`) is a development asset and is not issued by Tether. It has no monetary value and cannot be redeemed for real US dollars.
- **Verified On-Chain Settlement:** Tokens are disbursed via on-chain `ft_transfer` with verified receipts linked on NearBlocks.

### How to Use:
1. Open the **Agent Swap & Payout** tab in the sidebar or top navigation.
2. Enter the allocation amount in NEAR (e.g. 1.0 NEAR) and confirm the estimated Test USDT output.
3. Specify or click **"Use Connected Wallet"** to set the recipient address.
4. Check the explicit authorization box and click **Authorize & Execute Swap**.
5. Track real-time progress through the 4-stage stepper (`Authorization` $\to$ `NEP-145 Storage Registration` $\to$ `On-Chain Transfer` $\to$ `Confirmed Receipt`).

## Testnet checklist

- [ ] `npm test` passes; `npm run typecheck` is clean
- [ ] `testnet:check` shows the expected balance
- [ ] Real testnet tx hashes verified in the explorer for: allowed payment, and a failed payment
- [ ] Denied payments (cap, allowlist, unverified) never reach the executor
- [ ] Clean-clone run works from this README
