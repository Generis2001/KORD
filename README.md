# Mandate

### Autonomous AI Blockchain Agent on NEAR Testnet

> **Mandate** is an autonomous AI agent that executes real, automated blockchain transactions on the NEAR Testnet. Users can instruct the agent in natural language to perform token swaps, disburse native NEAR, enforce security policies, and manage treasury funds with verifiable on-chain cryptographic receipts.

Live Production URL: **[https://mandateme.vercel.app](https://mandateme.vercel.app)**

---

## ⚡ What Mandate Does on NEAR Testnet

Mandate turns natural language intent into verified, policy-guaranteed on-chain transactions on NEAR:

1. **Automated NEP-141 Token Swaps (NEAR ↔ Test USDT):**
   - Natural language swaps: *"Swap 2 NEAR for Test USDT"*.
   - Automatically handles NEP-145 storage deposit registration (`storage_deposit`).
   - Executes on-chain token exchange and transfers Mandate Test USDT (`usdt.fakes.testnet`) directly to the user's wallet.
   - Provides live NearBlocks block explorer transaction receipts.

2. **Policy-Guaranteed Blockchain Transfers:**
   - Direct payment directives: *"Pay 7 NEAR to zeal.testnet"*.
   - Validates recipient against an on-chain **Payable Allowlist**.
   - Enforces user-defined spending caps before signing.
   - Dispatches native NEAR transfers using the autonomous treasury key.

3. **Deterministic Safety Guardrails & Anti-Attack Protection:**
   - The LLM can only **propose** a transaction; it cannot sign or touch private keys.
   - The deterministic policy engine checks per-transaction limits, cumulative caps, and recipient allowlists.
   - Unauthorized attempts (e.g. paying unapproved vendors or exceeding budgets) are blocked locally before reaching RPC and logged to the audit ledger.

4. **Verifiable Settlement Ledger:**
   - Every transaction (swaps, disbursements, payments, blocked attacks) is timestamped with yoctoNEAR precision.
   - Clickable **NearBlocks Testnet Explorer** links for instant cryptographic verification.

5. **Multi-Account Profiles & Cloud Persistence:**
   - Switch or create isolated Mandate profiles (default: `generis.testnet`).
   - Real-time on-chain NEAR balance and live USDT balance display with official logos.
   - Full session and conversation persistence powered by **Neon PostgreSQL**.

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
                    │         AI Intent Parser (OpenAI)       │
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
   - Point out the linked wallet card at the bottom-left showing `generis.testnet` with live balances: **10.00 NEAR** and **60.00 USDT**.

2. **Automated Token Swap (0:10 - 0:25):**
   - Click the quick action: **⚡ Swap 2 NEAR for Test USDT** (or type *"Swap 2 NEAR for Test USDT"* in chat).
   - Show Mandate calculating the quote, registering token storage, and confirming the swap.
   - Click the **NearBlocks receipt link** to show the live on-chain transaction on testnet.

3. **Policy-Enforced Transfer (0:25 - 0:40):**
   - Type *"Pay 3 NEAR to zeal.testnet"* in the chat.
   - Watch Mandate check the allowlist, verify available quota, sign the transaction, and settle on-chain.

4. **Security & Attack Block (0:40 - 0:50):**
   - Type *"Pay 5,000 NEAR to hacker.testnet"*.
   - Show Mandate's policy engine autonomously blocking the rogue transaction due to spending cap violation and unauthorized recipient.

5. **Settlement Ledger (0:50 - 1:00):**
   - Open the **Settlement Ledger** to show the complete, immutable audit trail of all confirmed transfers, token swaps, and blocked attack attempts.

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
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-6.1-sol
```

### 4. Running Tests & Dev Server
```bash
# Run test suite (37 tests: policy rules, near transfers, treasury, swaps)
npm test

# Verify TypeScript compilation
npm run typecheck

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
