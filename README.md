# Mandate

### Autonomous research and wallet agent on NEAR Testnet

> **Mandate** is an autonomous agent that executes real, automated blockchain transactions on the NEAR Testnet. Users can instruct the agent in natural language to perform token swaps, disburse native NEAR, enforce security policies, and manage treasury funds with verifiable on-chain cryptographic receipts.

Live Production URL: **[https://mandateme.vercel.app](https://mandateme.vercel.app)**

---

## Specialist agents without paid APIs

Mandate runs three separate local specialists under the Orchestrator. No paid model service or API key is used, including when old OpenAI environment variables remain configured. Research fees are optional and use testnet NEAR through verified escrow.

- **Orchestrator:** preserves the requested subject, creates tasks and records the spending directive. Research alone never authorizes a purchase or transfer; fee amounts must be explicit.
- **Researcher:** searches public indexes from a plain-language topic; supplied links are optional. DuckDuckGo and Bing have Google and Wikipedia search fallbacks. Search results only locate pages: their snippets are never evidence. The researcher reads publications, follows relevant documentation, delivery policies and primary references, and performs a second search pass for unresolved requirements. Retrieval is bounded to 38 seconds and 32 requests to fit the serverless runtime.
- **Analyst:** builds topic answers from exact cited passages, groups evidence for requested benefits, risks, coverage and commercial terms, and compares publisher-backed prices when requested. Quantity estimates use exact arithmetic. General research does not produce an irrelevant supplier-price table.
- **Verifier:** checks retrieved-page integrity, observation timestamps, topic relevance, exact passage provenance, publisher independence, requested evidence coverage and arithmetic. Delivery terms can pass when the actual publisher policy is retrieved. An unanswered criterion triggers further discovery before a partial report and a focused clarification. **Refine request** keeps the research goal in the composer; a fee for the new request must be authorized explicitly.

Try **Research and analyze the benefits and risks of solar energy in Nigeria**, **Research the NEAR consensus mechanism**, or **Find three suppliers of 100 office chairs and compare published prices and delivery terms**. No source links are required. Add links when you have particular publications or suppliers in mind. **Compare NEAR and USDT market prices and pool liquidity on Ref Finance** uses free Ref Finance mainnet feeds; it does not trade or price Mandate Test USDT. Other NEAR questions use topic research rather than being substituted with token prices.

Public pages may block retrieval or omit facts. Mandate tries alternative discovery and published references, returns only supported passages, and asks for details such as a delivery destination or payment corridor when needed. It cannot guarantee that private or unpublished facts exist online. A verified report establishes source provenance and requested coverage, rather than independently certifying every publisher claim. The workflow uses deterministic local extraction and analysis, without a paid or generative model service.

### Research fees and verified testnet escrow

There is no automatic research fee. Use **Research solar energy in Nigeria; research fee 0.01 NEAR**, or **Research solar energy in Nigeria, charge a research fee of 0.01 testnet NEAR.** The fee goes to the configured `AGENT_RESEARCHER` (default: `mandate-generis-researcher.testnet`). **; pay 0.01 NEAR for research** also works. To choose a different allowlisted recipient, use **; research fee 0.01 NEAR to researcher.testnet** or **; escrow 0.01 NEAR to researcher.testnet**. Fees above an explicit NEAR budget or per-agent cap are blocked; duplicate fee clauses and fee-only commands are rejected. Dollar budgets and native spending ceilings do not imply a fee. The linked user must authorize wallet spending and allowlist the recipient. By default, the existing configured NEAR server account signs verifier approvals, and the deployed testnet escrow is used; no additional API account is needed. The agent wallet funds a new on-chain mandate; the configured verifier then calls the escrow contract's `approve_payment` with the evidence hash. A payment is reported as confirmed only after the contract emits `payment_confirmed`. Limits, recipient and owner checks, durable operation IDs and saved signed hashes protect retries. Missing configuration or incomplete evidence blocks payment.

```env
ESCROW_CONTRACT_ID=mandate-generis-escrow.testnet
VERIFIER_ACCOUNT_ID=mandate-generis-verifier.testnet
VERIFIER_PRIVATE_KEY=ed25519:...
```

These optional overrides are blockchain account credentials, not paid API keys. Set both verifier override values together. The owner agent and verifier need free faucet testnet NEAR for gas; this research escrow flow rejects mainnet. An ambiguous transaction pauses spending for reconciliation. If a payout fails, reconcile its receipt, then use **Refund escrow m_<mandate-id>** with the exact `mandateId` shown in the saved wallet operation. Mandate closes the owner-controlled mandate and refunds its remaining funds to the agent wallet. Depositing and releasing escrow are separate transactions.

Public online research can finish before wallet authorization. Mandate returns the sourced answer and then verifies the signed command before settling the fee. A linked address without spending authorization receives the research result with a blocked payment; no funds move. Access to private settlement-history audits still requires ownership verification before receipt lookups.

**Audit past purchases in the settlement ledger** loads this wallet's latest 50 stored operations and queries their final NEAR receipts. Missing or mismatched receipts are reported. An empty ledger stays empty; no settlements or compliance percentages are seeded or invented.

## Conversation history

Every sent message and Mandate response is saved, including transaction receipts and completed mandate results. Past chats appear under **Conversations** in the sidebar. Select any chat to revisit it; refreshing or returning to the workspace restores the last conversation opened for that wallet. **New conversation** starts a separate thread while keeping earlier chats available.

Replies are paired with the exact directive that started them, including when multiple mandates finish out of order or the history refreshes during execution. Live agent steps appear in a subtle expandable disclosure above the report. It stays folded by default; expand it to inspect the workflow, verification gaps, source receipts, budgets and settlement. The report and its evidence-linked comparisons remain visible below it.

Chats are backed up in the browser before syncing, and interrupted saves retry when you return or reconnect. Each linked wallet maintains its own history. PostgreSQL writes finish before a save is acknowledged on serverless deployments; configure `DATABASE_URL` or `POSTGRES_URL` for cloud history across devices. Local development saves to the persistent SQLite database. Conversation titles are listed separately from full messages so older chats remain accessible without loading every transcript at startup.

Approved payees are also stored per wallet in PostgreSQL when configured, or in persistent SQLite locally. Additions and removals finish saving before Mandate reports success. The initial agent payees are seeded once for each wallet; a removed payee stays removed after refreshing, reconnecting or restarting the server. Database failures block new spending checks instead of trusting a temporary local approval list.

## Agent wallet and single-command mandates

Each linked NEAR account has its own Mandate-controlled **implicit NEAR account**. Its address is a stable 64-character public key hash. The backend derives and signs with this wallet; the linked wallet signs deposits. Linked balances and agent balances are displayed separately. New profiles receive no synthetic NEAR or USDT credit. Available funds, stake balances, and cooldowns come from final on-chain views.

- `Deposit 2 NEAR` or `Deposit 5 USDT`: prepare a transfer for the linked wallet to sign. Deposit NEAR first to activate the agent account and pay network gas. USDT storage registration is included when needed.
- `Withdraw 2 NEAR` or `Withdraw 5 USDT`: send agent funds back to the linked owner.
- `Swap 2 NEAR for USDT` or `Swap 5 USDT for NEAR`: transfer the input to the demonstration treasury and the output back to the agent wallet. The testnet rate remains **1 NEAR = 5 Test USDT**; it is not a market price or DEX quote.
- `Send 2 USDT to alice.testnet` / `Pay 1 NEAR to alice.testnet`: pay from the agent wallet after checking the recipient allowlist. Research uses no paid API. Optional, explicitly requested research fees use the user's agent account through verified testnet escrow.
- `Stake 1 NEAR` / `Stake 5 USDT`: deposit to the configured staking provider.
- `Unstake 1 NEAR` / `Unstake 5 USDT`: start the provider's unbonding process. While an authorized MyNearWallet workspace remains open, Mandate checks every 30 seconds and collects available funds. When the workspace is closed, collection resumes on reopening; this is not a background scheduling service. `Claim 1 NEAR` or the **Withdraw unstaked funds** control also collects matured funds. Injected wallets may require a fresh signature for collection.

Open **Agent wallet** for balances, deposit/withdraw/stake/unstake controls, an explorer address link, and receipt links. Mandate retains a **0.02 NEAR gas reserve** and enforces single-transaction caps of 20 NEAR / 100 Test USDT, plus existing mainnet configuration limits. Staked balances cannot be spent until withdrawn.

Linking an address allows viewing and funding; it does not authorize spending. MyNearWallet installs a restricted authentication access key (receiver: the configured treasury, method: `mandate_auth`). The browser keeps that key locally and uses it only to sign account-, route-, body-, and timestamp-bound requests. The backend checks the signature and that the key still exists on the linked account. Meteor supports NEP-413 message proofs. Disconnecting removes the local authentication key; it does not erase balances or on-chain access keys.

**Mandate Test USDT** (`usdt.fakes.testnet`, 6 decimals) is a development token, is not issued by Tether, has no real monetary value, and is not redeemable for dollars.

### Staking provider setup

There is no default staking investment. Configure and verify contracts before enabling staking:

```env
# Keep this master key stable and backed up. Changing it changes every derived agent address.
# If omitted, the existing NEAR_PRIVATE_KEY is the derivation seed and must remain stable.
AGENT_WALLET_MASTER_KEY=<stable-random-server-secret>
NEAR_STAKING_POOL_ID=<validator-pool-on-the-configured-network>
USDT_STAKING_CONTRACT_ID=<compatible-token-staking-contract>
```

The NEAR adapter supports the standard staking-pool interface: `deposit_and_stake` with attached NEAR, `unstake({amount})`, `withdraw({amount})`, and `get_account_staked_balance`, `get_account_unstaked_balance`, `is_account_unstaked_balance_available` with `{account_id}`. Amounts are decimal strings in yoctoNEAR. Typical validator pools impose a multi-epoch cooldown.

USDT has no native validator staking mechanism. Its adapter requires a compatible token yield/staking contract with this explicit ABI:

- Accept NEP-141 `ft_transfer_call` from the configured USDT token, using `msg: {"action":"stake"}`. Attribute the position to `sender_id` (the agent account) and return the unused token amount. Mandate checks the token resolver's final used amount, so a refunded stake is never reported as successful.
- Expose `get_position({account_id}) -> {staked, unstaked, withdrawable}`, with all values as strings in 6-decimal atomic units, including accrued rewards if applicable.
- Expose `unstake({amount})` and `withdraw({amount})`, with 1 yoctoNEAR attached. Withdrawal must transfer actual USDT back to the caller, and complete its transfer promise before returning.

A different protocol ABI requires an adapter; entering an arbitrary contract address does not make it compatible. Missing providers are shown as unavailable. No fixed APY or synthetic staking rewards are advertised.

### Persistence and interrupted transactions

`wallet_operations` stores confirmed deposit and transaction receipts with idempotency IDs. PostgreSQL is authoritative when `DATABASE_URL`/`POSTGRES_URL` is configured, with advisory locks protecting the user account and shared swap treasury across serverless instances. SQLite supplies persistent receipts and account locks locally. Database failures prevent new signing rather than silently substituting another ledger.

Swaps have two on-chain legs and are not atomic. If a network response is ambiguous or payout fails after funding, the operation is marked **needs_review**, with available receipts retained. Further spending pauses to avoid duplicate payouts. The exact signed transaction hash is saved before broadcast. Use **Check on-chain status** to query that saved hash, then **Resume swap payout** for a conclusively funded swap; the input is never resent. Unknown chain status keeps spending paused. Reconcile before refunding it; never delete an operation or retry a payout solely because an HTTP request timed out. Back up the wallet derivation secret and database before changes to deployment keys. Historical quota fields in older databases are not used as wallet funds.

---

## 🏗️ Architecture & Security Model

```
                    ┌────────────────────────────────────────┐
                    │          User Chat / UI Directives     │
                    │ ("Swap 2 NEAR", "Pay 7 NEAR to zeal")  │
                    └───────────────────┬────────────────────┘
                                        │
                                        ▼
                    ┌────────────────────────────────────────┐
                    │         Explicit Wallet Command Parser       │
                    │   Extracts: Action, Amount, Recipient   │
                    └───────────────────┬────────────────────┘
                                        │ (Proposal only)
                                        ▼
                    ┌────────────────────────────────────────┐
                    │      Deterministic Policy Engine       │
                    │ • Spending limit verification          │
                    │ • Allowlist membership check           │
                    │ • Slippage & rate verification         │
                    └───────┬────────────────────────┬───────┘
                            │ (Approved)             │ (Denied)
                            ▼                        ▼
         ┌──────────────────────────────┐    ┌───────────────────────────┐
         │     Treasury Key Signing     │    │   Security Block Notice   │
         │       (near-api-js)          │    │ (Logged to Audit Ledger)  │
         └──────────────┬───────────────┘    └───────────────────────────┘
                        │
                        ▼
         ┌──────────────────────────────┐
         │     NEAR Testnet Network     │
         │ • Native Transfers           │
         │ • NEP-141 ft_transfer        │
         │ • NEP-145 storage_deposit    │
         └──────────────┬───────────────┘
                        │
                        ▼
         ┌──────────────────────────────┐
         │   NearBlocks Explorer Tx     │
         │   + Neon PostgreSQL State    │
         └──────────────────────────────┘
```

---

## 🎬 Twitter Demo Script (How to Demo Mandate)

Here is a recommended 60-second walkthrough to demonstrate Mandate on video:

1. **Overview & Linked Profile (0:00 - 0:10):**
   - Open **[mandateme.vercel.app](https://mandateme.vercel.app)**.
   - Point out the linked and agent wallet cards at the bottom-left showing `generis.testnet` with separate live balances. Deposit NEAR into the agent wallet before execution.

2. **Automated Token Swap (0:10 - 0:25):**
   - Click the quick action: **⚡ Swap 2 NEAR for Test USDT** (or type *"Swap 2 NEAR for Test USDT"* in chat).
   - Show Mandate calculating the quote, registering token storage, and confirming the swap.
   - Click the **NearBlocks receipt link** to show the live on-chain transaction on testnet.

3. **Policy-Enforced Transfer (0:25 - 0:40):**
   - Type *"Pay 3 NEAR to zeal.testnet"* in the chat.
   - Watch Mandate check the allowlist, verify available agent funds, sign the transaction, and settle on-chain.

4. **Security & Attack Block (0:40 - 0:50):**
   - Type *"Pay 5,000 NEAR to hacker.testnet"*.
   - Show Mandate's policy engine autonomously blocking the rogue transaction due to spending cap violation and unauthorized recipient.

5. **Settlement Ledger (0:50 - 1:00):**
   - Open the **Settlement Ledger** to show the recorded wallet transaction history of all confirmed transfers, token swaps, and blocked attack attempts.

---

## 🚀 Local Development Setup

### 1. Prerequisites
- Node.js 18+ (tested on Node 20 & 24)
- NEAR Testnet account funded with testnet NEAR

### 2. Installation
```bash
git clone https://github.com/Generis2001/mandate.git
cd mandate
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root directory:
```env
NEAR_NETWORK=testnet
NEAR_RPC_URL=https://rpc.testnet.near.org
NEAR_ACCOUNT_ID=mandate-generis-treasury.testnet
NEAR_PRIVATE_KEY=ed25519:...
TEST_USDT_TOKEN_ID=usdt.fakes.testnet
DATABASE_URL=postgresql://user:password@host/neondb?sslmode=require
```

### 4. Running Tests & Dev Server
```bash
# Run test suite (policy, wallet ownership, deposits, transfers, swaps, staking, cooldowns)
npm test

# Verify TypeScript compilation
npm run typecheck

# Run the specialists against live public market feeds without spending funds
npm run agents:check

# With valid testnet account keys: verify a 0.001 NEAR escrow research fee
# Allocates 0.03 faucet testnet NEAR to the owner's agent wallet only if needed
npm run agents:check -- --escrow-test

# Start local server
npx tsx src/server.ts
# Server runs at http://localhost:3000
```

---

## 🛠️ Technology Stack

- **Blockchain Layer:** JavaScript/TypeScript with [`near-api-js`](https://github.com/near/near-api-js) (no Python dependencies).
- **Smart Contract Standards:** NEP-141 (Fungible Token) and NEP-145 (Storage Management).
- **Backend Server:** Node.js HTTP server written in TypeScript.
- **Database / Persistence:** Dual-engine architecture with **Neon PostgreSQL** for serverless persistence and SQLite WAL for local runs.
- **Frontend:** Vanilla HTML5, CSS3, and JavaScript with custom design system, official vector logos, and zero bloated frameworks.
- **Hosting:** Vercel Serverless Functions with automated CI/CD deployment from branch `main`.

---

## 📄 License
MIT License.
