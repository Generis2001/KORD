# KORD

**Programmable control for autonomous agents.**

### Autonomous research and wallet agent on NEAR Testnet

**KORD** helps a business delegate public-source research and manage a separate agent treasury. Users give explicit spending permissions; local specialists retrieve and verify evidence, and an authorized research fee can settle through a NEAR escrow contract. Wallet commands deposit, withdraw, swap, send and stake actual testnet assets, with confirmed transaction receipts.

Hosted testnet demo: **[https://kord-generis2001.vercel.app](https://kord-generis2001.vercel.app)**

Public repository: **[Generis2001/KORD](https://github.com/Generis2001/KORD)**

## Judge guide

Built for **NEAR HACKATHON: Build Beyond Boundaries**. The product fits **Autonomous Business** (`business`), **AI Security & Defense** (`security`) and **Agent Economy** (`agents`) through payments for verified research. The repository's commits begin on October 22, 2026, within the October 19–November 14 build window in [HACKATHON.md, Q-001](https://nearhackathon.com/HACKATHON.md). Q-010 permits testnet projects, and Q-011 makes the listed integrations optional. The [hackathon review](docs/hackathon-review.md) records the sources, commit timestamps and remaining submission requirements.

Use the hosted demo for the browser walkthrough, or follow [Local development setup](#local-development-setup) to run the same app at `http://localhost:3000`. For a check that needs no wallet or blockchain credentials, install dependencies and run `npm run demo`; the [verification commands](#verification-commands) explain its output and the automated checks.

### Browser prerequisites

- Use a current browser with Web Crypto Ed25519 support, and allow the Meteor Wallet popup. Meteor's official SDK supports its web wallet and browser extension.
- Create or select **your own NEAR testnet account** in [Meteor Wallet](https://wallet.meteorwallet.app). Obtain faucet NEAR from [near-faucet.io](https://near-faucet.io/); have at least 2 testnet NEAR available for the 1 NEAR deposit below, wallet authorization and gas.
- For local execution, configure the server account as described below. The server/verifier needs its own faucet-funded account for escrow approval gas; it does not fund your browser wallet's deposit.
- All wallet commands below use **testnet**. Test USDT is `usdt.fakes.testnet`, a development token. Public Ref Finance market research reads mainnet market feeds; those observations do not price this test token.

### Core walkthrough: do X → see Y

Follow these steps in order. Each successful financial action should show a confirmed operation and a NearBlocks receipt; an error or pending operation is not a confirmed payment.

| Step | Do X | See Y |
| --- | --- | --- |
| 1. Authorize the wallet | Open **Connect wallet → Meteor Wallet**, select your testnet account and approve the connection. If the address was linked manually, open **Agent wallet → Authorize agent spending with Meteor Wallet**. | Your account appears in the sidebar. Authorization completes only after the backend verifies the signing key on that account. The agent has its own 64-character address and separate balances. |
| 2. Fund the agent | Send `Deposit 1 NEAR`, click **Sign deposit in wallet ↗** in the reply and approve the transaction in Meteor. | **Settlement ledger** records a confirmed 1 NEAR deposit and its receipt. The agent's balance updates; the app deducts account storage from available NEAR. Your linked wallet pays the deposit and its transaction gas. The agent retains a further 0.02 NEAR reserve for subsequent gas. |
| 3. Run free research | Send `Compare NEAR and USDT market prices and pool liquidity on Ref Finance`. | A report shows public market observations, source URLs, retrieval times and verification results. Expand the agent steps to inspect planning, retrieval, analysis and verification. The research fee is **not requested** and no payment is made. |
| 4. Check the service payee | Open **Approved payees**. Ensure `mandate-generis-researcher.testnet` is present; add it if it was removed. For a customized local setup, use the account in `AGENT_RESEARCHER`. | The researcher is an approved recipient for this linked wallet. Approval changes persist after refreshing. |
| 5. Pay for verified work | Send `Compare NEAR and USDT market prices and pool liquidity on Ref Finance; research fee 0.001 NEAR`. | When evidence verification passes, the agent funds a directive in the escrow contract and the configured verifier releases 0.001 testnet NEAR to the researcher. The reply shows a **confirmed** payment and an explorer link; the ledger records funding and release separately. Failed evidence or authorization produces a blocked payment instead. |
| 6. Check recipient restrictions | Ensure `blocked-demo.testnet` is absent from **Approved payees**, then send `Pay 0.01 NEAR to blocked-demo.testnet`. | The reply requires approving that recipient first. No payment is submitted and no confirmed transaction receipt is created for this rejection. |
| 7. Check the amount limit | Send `Withdraw 21 NEAR`. | The request is rejected for exceeding the 20 NEAR single-transaction limit, before an on-chain withdrawal is signed. This tests the cap even when the agent holds less than 21 NEAR. |
| 8. Inspect and revisit | Open **Settlement ledger**, follow a confirmed transaction link, refresh the workspace, then reopen the conversation from the sidebar. | The explorer identifies the actual signer, recipient and transaction outcome. The conversation restores its report and receipt links, and the ledger retains the confirmed operations for this wallet. |

The research-payment workflow is steps 3–5: a user directive produces sourced work, evidence checks gate the authorized fee, and the result has a settlement receipt. Reading public sources is free; a spending ceiling alone never creates a fee.

### Additional treasury checks

Start after funding and authorization. Run the NEAR staking steps together so the position is easy to recognize; amounts can differ slightly because validator shares round and rewards may accrue.

| Do X | See Y |
| --- | --- |
| Send `Swap 0.1 NEAR for USDT`. | Ref Finance pool 57 executes the trade. The reply reports the actual Test USDT received and links the transaction; the output remains in the agent wallet. 0.1 NEAR is the minimum supported NEAR swap. The output varies with current reserves. |
| Send `Swap 0.1 USDT for NEAR` after acquiring at least 0.1 Test USDT. | The DEX returns wrapped NEAR and the adapter unwraps it. The reply and ledger provide the swap and native-withdrawal receipts. |
| Send `Stake 0.1 NEAR`, then `Unstake 0.1 NEAR`. | The staking receipt appears and the agent's staking position increases, then moves into the unstaking balance. Withdrawal waits for the validator's epoch cooldown; it is not an immediate return to available funds. |
| Once the provider reports funds withdrawable, use **Withdraw unstaked funds** or `Claim 0.1 NEAR` if that amount remains available. | A confirmed withdrawal returns funds to the agent account. An authorized open workspace may already have collected matured funds during its 30-second polling cycle. |
| Send `Withdraw 0.1 NEAR` while the agent has that amount above its gas reserve. | The withdrawal pays your linked owner account, reduces available agent funds and produces a confirmed receipt. |

Test USDT staking uses a separate vault with a 60-second cooldown. To reproduce a complete `Stake 5 USDT → Unstake 5 USDT → Claim 5 USDT` cycle with faucet tokens, use the optional [live protocol check](#verification-commands) with an isolated funded account. It mints Test USDT when needed and waits for maturity; the browser walkthrough does not require those 5 tokens.

If public feeds are unreachable or required evidence is missing, expect a partial report and a blocked research fee. If a transaction is **needs_review**, open **Agent wallet → Check on-chain status** before issuing another spending command. A funded swap may then offer **Resume swap payout**. These states are part of the recovery flow, not proof that a transfer completed.

## NEAR features and deployed contracts

| NEAR feature used | What it enables in KORD | Implementation |
| --- | --- | --- |
| Named accounts and implicit accounts | A linked testnet account identifies the owner. Each owner gets a separate agent account derived from a stable server secret; its address is the Ed25519 public key encoded as 64 hexadecimal characters. | [Agent account derivation and balances](src/agent-wallet.ts) |
| Function-call access keys and NEP-413 message proofs | Meteor installs a browser authentication key scoped to the configured server account and `mandate_auth`. Signed API requests bind the owner, route, body and timestamp, and the backend checks that the key is still installed. Meteor also supports NEP-413 proofs. | [Meteor adapter](src/browser/meteor.ts), [browser request signing](public/wallet.js), [ownership verification](src/wallet-auth.ts) |
| NEAR smart contracts and native transfers | The user funds escrow from the agent account. The contract enforces budget, cumulative per-agent cap, recipient allowlist, verifier authority and one payout per task; transfer callbacks account for failed payouts and refunds. | [Escrow contract](contract/src/lib.rs), [funding and release adapter](src/escrow.ts) |
| NEP-141 tokens and NEP-145 storage | Test USDT deposits, sends and staking use token transfer calls, with storage registration when required. Token resolver receipts establish the amount actually accepted. | [Wallet transaction adapters](src/agent-wallet.ts), [Test USDT vault](staking-contract/src/lib.rs) |
| Ref Finance testnet contracts and wrapped NEAR | Reserve-based swaps use `get_return` and `ft_transfer_call`, a saved minimum output, and separate native wrapping/unwrapping transactions. | [DEX quotes and output receipts](src/dex.ts), [swap execution](src/agent-wallet.ts) |
| Standard NEAR staking-pool interface | The agent stakes with `deposit_and_stake`, unstakes shares, reads live positions and withdraws after the validator cooldown. | [Staking execution and position views](src/agent-wallet.ts) |
| Final NEAR RPC receipts and NearBlocks | Operations save the signed transaction hash before broadcast and query final outcomes. The ledger and history expose receipts; reconciliation avoids signing a duplicate after an ambiguous response. | [Wallet execution](src/agent-wallet.ts), [durable operations](src/wallet-store.ts), [receipt audit](src/receipt-audit.ts) |

The backend controls the agent accounts' signing keys. General wallet spending checks run on the server; escrow additionally enforces its payment constraints on-chain. The scoped browser key proves ownership for KORD requests, while deposits still need a linked-wallet transaction signature. Deterministic evidence checks and the enabled local model review gate approval by the configured verifier signer. This prototype does not use confidential inference or cross-chain settlement.

These existing testnet contracts are the defaults for a fresh local setup; no contract deployment is needed to follow the walkthrough. Overrides must implement the interfaces described later in this README.

| Role | Deployed testnet address | Configuration / purpose |
| --- | --- | --- |
| Verified research escrow | [`mandate-generis-escrow.testnet`](https://testnet.nearblocks.io/address/mandate-generis-escrow.testnet) | `ESCROW_CONTRACT_ID`; creates escrow directives, approves task payments and refunds unused funds. |
| NEAR validator staking pool | [`kiln.pool.f863973.m0`](https://testnet.nearblocks.io/address/kiln.pool.f863973.m0) | `NEAR_STAKING_POOL_ID`; standard staking-pool methods and epoch cooldown. |
| Test USDT staking vault | [`usdt.mandate-live-20261029.testnet`](https://testnet.nearblocks.io/address/usdt.mandate-live-20261029.testnet) | `USDT_STAKING_CONTRACT_ID`; token staking with a 60-second unstaking cooldown. |
| Test USDT token | [`usdt.fakes.testnet`](https://testnet.nearblocks.io/address/usdt.fakes.testnet) | `TEST_USDT_TOKEN_ID`; six-decimal development token used by wallet operations and pool 57. |
| Ref Finance DEX | [`ref-finance-101.testnet`](https://testnet.nearblocks.io/address/ref-finance-101.testnet) | `TESTNET_DEX_CONTRACT_ID`, `TESTNET_DEX_POOL_ID=57`; pool pairs `wrap.testnet` and `usdt.fakes.testnet`. |
| Wrapped NEAR | [`wrap.testnet`](https://testnet.nearblocks.io/address/wrap.testnet) | Fixed in the testnet DEX adapter; wraps input NEAR and unwraps reverse-swap output. |

The default research recipient is [`mandate-generis-researcher.testnet`](https://testnet.nearblocks.io/address/mandate-generis-researcher.testnet), configured by `AGENT_RESEARCHER`. The server/verifier is the account supplied in `.env`, and the user's agent address is displayed in **Agent wallet**; these signer accounts are separate from the fixed contracts above. [Recorded live testnet checks](#confirmed-live-testnet-checks) provide example transaction receipts from October 29, 2026.

---

## Specialist agents without paid APIs

KORD combines public-source retrieval and deterministic evidence checks with an optional local **Qwen3 model through Ollama**. The model plans research, analyzes business evidence and separately reviews its conclusions. Inference uses your computer, with no paid model API. Explicit research fees remain a separate, optional testnet NEAR authorization.

- **Orchestrator:** preserves the requested subject, creates tasks and records the spending directive. Research alone never authorizes a purchase or transfer; fee amounts must be explicit.
- **Researcher:** uses local model reasoning to identify relevant evidence and search queries, then retrieves public publications and follows useful policy pages and references. Supplied links are optional. Search snippets locate pages and never become evidence. Retrieval remains bounded to 32 requests.
- **Analyst:** reasons about the business implications, tradeoffs and recommendations from the retrieved evidence. The model selects supplied passage IDs, which KORD resolves to exact original source quotes or published product metadata. The existing deterministic price comparisons and exact quantity arithmetic remain visible.
- **Verifier:** checks source integrity, freshness, relevance, coverage and arithmetic, then makes a separate local model call to challenge the conclusions and their qualifications. Model approval cannot override failed source checks. Missing evidence or a failed reasoning stage produces a partial report and blocks the research fee. **Refine request** retains the question; each new fee requires explicit authorization.

Try **Research and analyze the benefits and risks of solar energy in Nigeria**, **Research the NEAR consensus mechanism**, or **Find three suppliers of 100 office chairs and compare published prices and delivery terms**. No source links are required. Add links when you have particular publications or suppliers in mind. **Compare NEAR and USDT market prices and pool liquidity on Ref Finance** uses free Ref Finance mainnet feeds; it does not trade or price KORD Test USDT. Other NEAR questions use topic research rather than being substituted with token prices.

Public pages may block retrieval or omit facts. KORD tries alternative discovery and published references and asks for missing details such as the delivery destination. Source checks and a model review establish evidence provenance and requested coverage; they do not independently certify a publisher's claims. Qwen3's small CPU model can miss nuance, so unsupported facts remain gaps. With `LOCAL_AI_ENABLED=false`, the original source retrieval and deterministic reports remain available and are labelled accordingly.

### Free local model and HTTPS endpoint

Install [Ollama](https://ollama.com/download), start it with cloud inference disabled, and download the CPU model:

```bash
OLLAMA_NO_CLOUD=1 ollama serve
# In another terminal:
ollama pull qwen3:0.6b
npm run model:start
```

Local inference is `http://127.0.0.1:11434/api/chat`. Enable it for local app research in `.env`:

```env
LOCAL_AI_ENABLED=true
LOCAL_AI_MODEL=qwen3:0.6b
LOCAL_AI_URL=http://127.0.0.1:11434/api/chat
```

For Vercel, install the free [cloudflared tool](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), then run:

```bash
npm run model:expose
npm run model:status
```

`model:expose` prints the HTTPS `/api/chat` URL and saves it to `.secrets/local-model-endpoint`. The private bearer token is generated in `.secrets/local-model-token`; keep it on the server. Configure `LOCAL_AI_ENABLED=true`, `LOCAL_AI_MODEL=qwen3:0.6b`, `LOCAL_AI_URL=<printed HTTPS URL>` and `LOCAL_AI_TOKEN=<private token>` in Vercel. The proxy allows only the selected local model, bounded inference and a readiness check. Model installation, deletion and filesystem routes are blocked. Research input contains public evidence and checked comparisons; wallet keys, balances and fee authorization do not enter the model.

The computer, Ollama and tunnel must stay running. A restarted free tunnel gets a new URL, which must be updated in Vercel and followed by a deployment. `npm run model:stop` stops services started by the helper. The 300-second Vercel function limit uses Hobby Fluid Compute's supported free limit. CPU inference has no API charge; it uses your existing hardware, electricity and connection. Keep the model endpoint available through hackathon judging.

### Research fees and verified testnet escrow

There is no automatic research fee. Use **Research solar energy in Nigeria; research fee 0.01 NEAR**, or **Research solar energy in Nigeria, charge a research fee of 0.01 testnet NEAR.** The fee goes to the configured `AGENT_RESEARCHER` (default: `mandate-generis-researcher.testnet`). **; pay 0.01 NEAR for research** also works. To choose a different allowlisted recipient, use **; research fee 0.01 NEAR to researcher.testnet** or **; escrow 0.01 NEAR to researcher.testnet**. Fees above an explicit NEAR budget or per-agent cap are blocked; duplicate fee clauses and fee-only commands are rejected. Dollar budgets and native spending ceilings do not imply a fee. The linked user must authorize wallet spending and allowlist the recipient. By default, the existing configured NEAR server account signs verifier approvals, and the deployed testnet escrow is used; no additional API account is needed. The agent wallet funds a new on-chain escrow directive; the configured verifier then calls the escrow contract's `approve_payment` with the evidence hash. A payment is reported as confirmed only after the contract emits `payment_confirmed`. Limits, recipient and owner checks, durable operation IDs and saved signed hashes protect retries. Missing configuration or incomplete evidence blocks payment.

Expand the folded workflow to inspect the **Research fee receipt**: the fee amount, NEAR testnet network, wallet owner, recipient, escrow contract, recorded time, operation and escrow directive IDs, and evidence hash. Funding and fee release have separate transaction hashes and explorer links. Funding alone does not prove that the researcher was paid. Pending, failed and unconfirmed releases keep their recorded proof visible without displaying a confirmed fee. Saved conversations restore the same receipt; no transaction is resent by viewing it.

```env
ESCROW_CONTRACT_ID=mandate-generis-escrow.testnet
VERIFIER_ACCOUNT_ID=mandate-generis-verifier.testnet
VERIFIER_PRIVATE_KEY=ed25519:...
```

These optional overrides are blockchain account credentials, not paid API keys. Set both verifier override values together. The owner agent and verifier need free faucet testnet NEAR for gas; this research escrow flow rejects mainnet. An ambiguous transaction pauses spending for reconciliation. If a payout fails, reconcile its receipt, then use **Refund escrow m_<directive-id>** with the exact `mandateId` shown in the saved wallet operation. KORD closes the owner-controlled escrow directive and refunds its remaining funds to the agent wallet. Depositing and releasing escrow are separate transactions.

Enabled local reasoning and private history require a wallet ownership proof before execution. The signed directive is admitted while fresh; KORD checks that the key remains installed before settling the exact authorized fee, even after a long research job. Key revocation blocks payment. Without local reasoning, public-source research can still finish before fee authorization, returning a report with a blocked payment if ownership was not proven.

**Audit past purchases in the settlement ledger** loads this wallet's latest 50 stored operations and queries their final NEAR receipts. Missing or mismatched receipts are reported. An empty ledger stays empty; no settlements or compliance percentages are seeded or invented.

## Conversation history

Every sent message and KORD response is saved, including transaction receipts and completed directive results. Past chats appear under **Conversations** in the sidebar. Select any chat to revisit it; refreshing or returning to the workspace restores the last conversation opened for that wallet. **New conversation** starts a separate thread while keeping earlier chats available.

Replies are paired with the exact directive that started them, including when multiple directives finish out of order or the history refreshes during execution. Live agent steps appear in a subtle expandable disclosure above the report. It stays folded by default; expand it to inspect the workflow, verification gaps, source receipts, budgets and settlement. The report and its evidence-linked comparisons remain visible below it.

Chats are backed up in the browser before syncing, and interrupted saves retry when you return or reconnect. Each wallet maintains its own history, with ownership signatures required for reads, saves and deletion. PostgreSQL writes finish before a save is acknowledged on serverless deployments; configure `DATABASE_URL` or `POSTGRES_URL` for cloud history across devices. Local development saves to SQLite. Existing browser settings, authorization keys and conversations migrate to the KORD names on the same origin.

Approved payees are also stored per wallet in PostgreSQL when configured, or in persistent SQLite locally. Additions and removals finish saving before KORD reports success. The initial agent payees are seeded once for each wallet; a removed payee stays removed after refreshing, reconnecting or restarting the server. Database failures block new spending checks instead of trusting a temporary local approval list.

## Agent wallet and single-command directives

Each linked NEAR account has its own KORD-controlled **implicit NEAR account**. Its address is the stable public key encoded as 64 hexadecimal characters. The backend derives and signs with this wallet; the linked wallet signs deposits. Linked balances and agent balances are displayed separately. New profiles receive no synthetic NEAR or USDT credit. Available funds, stake balances, and cooldowns come from final on-chain views.

- `Deposit 2 NEAR` or `Deposit 5 USDT`: prepare a transfer for the linked wallet to sign. Deposit NEAR first to activate the agent account and pay network gas. USDT storage registration is included when needed.
- `Withdraw 2 NEAR` or `Withdraw 5 USDT`: send agent funds back to the linked owner.
- `Swap 0.1 NEAR for USDT` or `Swap 0.1 USDT for NEAR`: trade on Ref Finance testnet, wrapping/unwrapping native NEAR as needed. Quotes come from current pool reserves and include the pool fee, with a default 2% output tolerance. Funds return to the agent wallet. The Swap panel lets you set an explicit minimum output. Prices change with trades and available testnet liquidity.
- `Send 2 USDT to alice.testnet` / `Pay 1 NEAR to alice.testnet`: pay from the agent wallet after checking the recipient allowlist. Research uses no paid API. Optional, explicitly requested research fees use the user's agent account through verified testnet escrow.
- `Stake 1 NEAR` / `Stake 5 USDT`: deposit to the configured staking provider.
- `Unstake 1 NEAR` / `Unstake 5 USDT`: start the provider's unbonding process. While a workspace authorized with Meteor Wallet remains open, KORD checks every 30 seconds and collects available funds. When the workspace is closed, collection resumes on reopening; this is not a background scheduling service. `Claim 1 NEAR` or the **Withdraw unstaked funds** control also collects matured funds.

Open **Agent wallet** for balances, deposit/withdraw/stake/unstake controls, an explorer address link, and receipt links. KORD retains a **0.02 NEAR gas reserve** and enforces single-transaction caps of 20 NEAR / 100 Test USDT, plus existing mainnet configuration limits. Staked balances cannot be spent until withdrawn.

Linking an address allows viewing and funding; it does not authorize spending. Choose **Meteor Wallet** or **Authorize agent spending with Meteor Wallet** to connect through Meteor's official SDK, using its web wallet or browser extension. Meteor installs a restricted authentication access key (receiver: the configured treasury, method: `mandate_auth`). The browser keeps that key locally and uses it only to sign account-, route-, body-, and timestamp-bound requests. The backend verifies that the key is installed on the linked account before authorization succeeds, and checks it again for spending requests. Deposits are signed in Meteor and confirmed on-chain. Meteor also supports NEP-413 message proofs for accounts connected without a local authentication key. Disconnecting removes the local authentication key and SDK connection; it does not erase balances or on-chain access keys.

**KORD Test USDT** (`usdt.fakes.testnet`, 6 decimals) is a development token, is not issued by Tether, has no real monetary value, and is not redeemable for dollars.

### Staking provider setup

Testnet defaults are an active NEAR validator pool and KORD's deployed Test USDT vault. The vault holds transferred tokens, applies a 60-second unstaking cooldown, and distributes rewards only when actual tokens are deposited with `{"action":"fund_rewards"}`. No fixed yield is promised. USDT vault staking is token custody with funded rewards; it does not validate the NEAR network.

```env
# Keep this master key stable and backed up. Changing it changes every derived agent address.
# If omitted, the existing NEAR_PRIVATE_KEY is the derivation seed and must remain stable.
AGENT_WALLET_MASTER_KEY=<stable-random-server-secret>
NEAR_STAKING_POOL_ID=kiln.pool.f863973.m0
USDT_STAKING_CONTRACT_ID=usdt.mandate-live-20261029.testnet
TESTNET_DEX_CONTRACT_ID=ref-finance-101.testnet
TESTNET_DEX_POOL_ID=57
```

The NEAR adapter supports the standard staking-pool interface: `deposit_and_stake` with attached NEAR, `unstake({amount})`, `withdraw({amount})`, and `get_account_staked_balance`, `get_account_unstaked_balance`, `is_account_unstaked_balance_available` with `{account_id}`. Amounts are decimal strings in yoctoNEAR. Typical validator pools impose a multi-epoch cooldown.

USDT has no native validator staking mechanism. Its adapter requires a compatible token yield/staking contract with this explicit ABI:

- Accept NEP-141 `ft_transfer_call` from the configured USDT token, using `msg: {"action":"stake"}`. Attribute the position to `sender_id` (the agent account) and return the unused token amount. KORD checks the token resolver's final used amount, so a refunded stake is never reported as successful.
- Expose `get_position({account_id}) -> {staked, unstaked, withdrawable}`, with all values as strings in 6-decimal atomic units, including accrued rewards if applicable.
- Expose `unstake({amount})` and `withdraw({amount})`, with 1 yoctoNEAR attached. Withdrawal must transfer actual USDT back to the caller, and complete its transfer promise before returning.

A different protocol ABI requires an adapter; entering an arbitrary contract address does not make it compatible. Mainnet has no staking defaults. To deploy your own testnet vault, build `staking-contract` for `wasm32-unknown-unknown` and run `npm run staking:setup`; `-- --redeploy` updates that configured vault without reinitializing its positions.

Ref Finance pool 57 pairs `wrap.testnet` with `usdt.fakes.testnet`. It was funded with 2 faucet NEAR and 10 Test USDT, with a 0.3% pool fee. This is limited testnet liquidity, so use small demo amounts and inspect the quote. No paid service is needed. NEAR Intents does not provide a testnet deployment, so this adapter executes same-chain testnet swaps. The old treasury swap remains available only with the explicit `SWAP_MODE=legacy_demo` compatibility setting.

### Persistence and interrupted transactions

`wallet_operations` stores confirmed deposit and transaction receipts with idempotency IDs. PostgreSQL is authoritative when `DATABASE_URL`/`POSTGRES_URL` is configured, with advisory locks protecting the user account and shared swap treasury across serverless instances. SQLite supplies persistent receipts and account locks locally. Database failures prevent new signing rather than silently substituting another ledger.

DEX swaps save their quote, minimum output, wrapping step and actual received output. The trade executes through Ref Finance's token callback, while native NEAR wrapping/unwrapping takes separate transactions. Legacy treasury swaps also have separate funding and payout transactions. If a network response is ambiguous, the operation is marked **needs_review**, with available receipts retained. Further spending pauses to avoid duplicate payments. The exact signed transaction hash is saved before broadcast. Use **Check on-chain status** to query that saved hash, then **Resume swap payout** for a conclusively funded swap. A confirmed DEX trade is never repeated: a pending reverse swap resumes only native NEAR unwrapping. Unknown chain status keeps spending paused. Definite balance rejections can be reconciled as failed. Never delete an operation or retry solely because an HTTP request timed out. Back up the wallet derivation secret and database before changes to deployment keys. Historical quota fields in older databases are not used as wallet funds.

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
         │     Agent Wallet Signing     │    │   Security Block Notice   │
         │       (near-api-js)          │    │ (Logged to Audit Ledger)  │
         └──────────────┬───────────────┘    └───────────────────────────┘
                        │
                        ▼
         ┌──────────────────────────────┐
         │     NEAR Testnet Network     │
         │ • Native Transfers           │
         │ • NEP-141 ft_transfer        │
         │ • NEP-145 storage_deposit    │
         │ • Ref swaps & staking calls │
         └──────────────┬───────────────┘
                        │
                        ▼
         ┌──────────────────────────────┐
         │   NearBlocks Explorer Tx     │
         │   + Neon PostgreSQL State    │
         └──────────────────────────────┘
```

---

## Demo recording

Pre-fund and authorize the agent wallet, then record one complete research-to-payment loop from the [judge walkthrough](#core-walkthrough-do-x--see-y). Show the directive, cited result, verification decision, escrow receipt and recipient in the explorer. Include a blocked unapproved-recipient request or `Withdraw 21 NEAR`, then one optional swap or staking command. Rejected commands have no confirmed on-chain receipt; inspect the rejection in the conversation rather than claiming it is a paid ledger entry.

For the hackathon's public demo post, state that KORD was built at NEAR HACKATHON, include **@NEARProtocol** and **#NEARHackathon**, attach the recording and link the public repository and hosted demo. Keep the user action and its visible result central. A local-only demo needs video so judges can inspect the behavior without access to your machine.

---

## Local development setup

### Install and check without blockchain credentials

Use **Node.js 24 LTS and npm**. From the root of a fresh repository checkout:

```bash
npm ci
npm test
npm run typecheck
npm run demo
```

`npm ci` installs the lockfile versions and runs the wallet build through `postinstall`. It produces `public/meteor.bundle.js` from the official Meteor SDK adapter. The tests use generated test keys and mocked blockchain providers; they do not spend funds. `npm run typecheck` should exit successfully. `npm run demo` prints a sourced Ref Finance market report, specialist statuses and evidence verification, with no requested research fee; it needs public network access but no wallet or paid model API key. Feed failures can produce a partial report.

Run `npm run build` again after changing the browser adapter or SDK. Native dependencies may require platform build tools if no prebuilt binary is available. Rust is only needed to rebuild the contracts; their deployed defaults are sufficient for the app walkthrough.

### Configure the local server

Copy the template in a fresh checkout:

```bash
cp .env.example .env
```

Replace `your-treasury.testnet` and `ed25519:...` with the account ID and valid Ed25519 secret key of a **dedicated testnet server account you control**. Create and fund that account through a NEAR wallet/faucet before running the financial checks. Keep at least 0.2 testnet NEAR available for verifier gas; the optional live protocol script below also needs 1 testnet NEAR to fund its own isolated agent. A generated keypair or an unchanged placeholder does not create or fund an on-chain account.

A minimal `.env` for the existing deployments is:

```env
NEAR_NETWORK=testnet
NEAR_RPC_URL=https://test.rpc.fastnear.com
NEAR_ACCOUNT_ID=your-treasury.testnet
NEAR_PRIVATE_KEY=ed25519:...
KORD_DB=kord.db
ALLOW_MAINNET=false
ESCROW_CONTRACT_ID=mandate-generis-escrow.testnet
AGENT_RESEARCHER=mandate-generis-researcher.testnet
TEST_USDT_TOKEN_ID=usdt.fakes.testnet
```

The account and secret-key values above must be replaced locally; the remaining values select the existing testnet deployment. `.env` and `.secrets/` are ignored by Git. Server credentials are separate from the wallet connection in the browser and are never entered into the frontend.

| Variable | Requirement and default | Why it matters |
| --- | --- | --- |
| `NEAR_NETWORK` | Set to `testnet` for this walkthrough. | Selects testnet account validation and adapters. |
| `NEAR_RPC_URL` | Optional; testnet defaults to `https://test.rpc.fastnear.com`. | Used for account/key queries, balances, contract views and transaction confirmation. |
| `NEAR_ACCOUNT_ID`, `NEAR_PRIVATE_KEY` | Required to start the server; use a real dedicated testnet account and its installed Ed25519 key. | Supplies the default verifier signer and fallback agent-wallet derivation seed. The template's placeholder key cannot approve fees. |
| `AGENT_WALLET_MASTER_KEY` | Optional; defaults to `NEAR_PRIVATE_KEY`. Use a stable private server secret when configured. | Derives the agent account for each linked owner. Preserve it across restarts; changing the seed changes those addresses. |
| `KORD_DB` | Optional; `kord.db` for fresh local installs. Existing database paths and the previous environment setting remain supported. | Persistent SQLite conversation, approval and receipt storage. Its parent directory must be writable. |
| `DATABASE_URL` or `POSTGRES_URL` | Optional locally; configure one for durable Vercel/serverless storage. `DATABASE_URL` takes precedence. | PostgreSQL persists conversations, approvals and operations across instances. Local runs work with SQLite alone. |
| `ESCROW_CONTRACT_ID` | Optional override; defaults to `mandate-generis-escrow.testnet`. | Research fee funding, approval and refund contract. |
| `AGENT_RESEARCHER` | Optional override; defaults to `mandate-generis-researcher.testnet`. | Receives the explicit research fee and must be on the owner's approved-payee list. |
| `VERIFIER_ACCOUNT_ID`, `VERIFIER_PRIVATE_KEY` | Optional paired overrides; otherwise the server account/key is the verifier. | Both values must be set together. The verifier must differ from the paid researcher and have an installed key allowed to call `approve_payment`, plus gas funds. |
| `TEST_USDT_TOKEN_ID` | Optional; `usdt.fakes.testnet`. | Six-decimal test token. The default DEX pool and staking vault use this token. |
| `NEAR_STAKING_POOL_ID` | Optional; `kiln.pool.f863973.m0` on testnet. | Standard NEAR staking-pool provider. |
| `USDT_STAKING_CONTRACT_ID` | Optional; `usdt.mandate-live-20261029.testnet` for the default test token. | Compatible token staking vault. A different token requires a matching provider. |
| `TESTNET_DEX_CONTRACT_ID`, `TESTNET_DEX_POOL_ID` | Optional; `ref-finance-101.testnet` and `57`. | Must identify a live simple pool containing `wrap.testnet` and the configured Test USDT token. |
| `SWAP_MODE` | Leave unset for reserve-based DEX execution. | `legacy_demo` explicitly selects the older fixed-rate treasury adapter. |

Use the existing contract addresses for the judge walkthrough. Deploying a custom escrow or vault is a separate development task; entering an arbitrary address does not implement the required interface.

### Start and inspect the app

```bash
npx tsx src/server.ts
```

Expected startup output: `[KORD] Running at http://localhost:3000`. Open that URL in a current browser and follow the [judge guide](#judge-guide). Port 3000 must be available; `VERCEL` should be unset for this local server command. On Vercel, the exported request handler is used instead of starting a listener, and the deployment builds the Meteor bundle.

In another terminal, this configuration check requires no wallet signature or transaction:

```bash
curl -fsS http://localhost:3000/api/wallet/config
```

Expected JSON: `network` is `testnet`, `authReceiver` matches your `NEAR_ACCOUNT_ID`, and `walletUrl` is `https://wallet.meteorwallet.app`.

### Verification commands

| Command | Preconditions | Expected result |
| --- | --- | --- |
| `npm test` | Installed dependencies; no blockchain credentials or network required. | Passing tests covering policies, wallet proofs, Meteor adapter behavior, deposits, DEX output checks, staking cooldowns, escrow and persistence. Blockchain providers are mocked. |
| `npm run typecheck` | Installed dependencies. | Successful exit with no TypeScript diagnostics. |
| `npm run demo` | Public internet access; no account credentials. | Research report, local specialist statuses and verification results; no fee requested. |
| `npm run agents:check` | Public internet access; SQLite is sufficient. | JSON with retrieved sources, completed specialist roles, verification and `payout.status: not_requested`. Missing required evidence causes a nonzero exit. |
| `npm run testnet:check` | Valid server `.env`, existing funded account and reachable testnet RPC. | Prints the configured network, RPC, account and current balance. With no `--send` flag, it submits no transaction. |
| `npm run protocols:check` | Valid server `.env`, reachable RPC and the deployed provider defaults. | JSON with both staking positions and a live 0.1 NEAR DEX quote; no transaction is submitted. |
| `npm run agents:check -- --escrow-test` | Funded dedicated testnet server account, gas for the verifier and a valid escrow/researcher configuration. | Funds the server account's derived agent with 0.2 NEAR if needed, verifies research and pays a 0.001 NEAR fee. Prints funding/payout receipts and the researcher balance increment; exits nonzero if verification or settlement fails. |
| `npm run protocols:check -- --execute --staking --swap` | An isolated funded testnet server account with no unresolved operations or pre-existing USDT staking position. Use a separate local database for this check. | Funds its derived agent with 1 NEAR if needed, mints faucet Test USDT, exercises stake/unstake/claim and both swap directions, and prints confirmed receipts. USDT waits for its 60-second cooldown; NEAR remains subject to validator epochs. |

The last two commands execute testnet transactions from the server credentials; the browser is not their signer. Use an owned testnet full-access server key for these scripts: automatic agent funding transfers NEAR, and the protocol check calls the token contracts. The protocol check needs more than 1 NEAR in the server account when it must fund its agent, plus token registration and gas. Reconcile any unresolved operation before rerunning a live check. Keep `NEAR_NETWORK=testnet` and `ALLOW_MAINNET=false` for judge reproduction.

### Confirmed live testnet checks

Checks on October 29, 2026 used an isolated faucet-funded account. They exercised the same command parser and agent wallet adapters used by the app.

| Command / check | Observed result | Final receipt |
| --- | --- | --- |
| `Research stablecoins from 2 sources; research fee 0.001 NEAR` | Public sources discovered without supplied links; verification passed; researcher balance increased by exactly 0.001 NEAR | [Research payout](https://testnet.nearblocks.io/txns/Br7W2mERxTtSWETDJJZpgjTHuaHMPsUAhtJan1mAuZjQ) |
| `Stake 0.1 NEAR`, then `Unstake 0.1 NEAR` | Validator stake and unstake confirmed; withdrawal remains subject to epoch cooldown | [Stake](https://testnet.nearblocks.io/txns/8Q7rokBCRbTPGuVM95C9Z656vMDz4JGQpEHkZsk46cot), [unstake](https://testnet.nearblocks.io/txns/28egx2UxSU6t8uh9oZdeLNi8FmhFinD1wS6FLNc4PERQ) |
| `Stake 5 USDT`, `Unstake 5 USDT`, then `Claim 5 USDT` | Full 5 Test USDT principal returned after the vault cooldown | [Stake](https://testnet.nearblocks.io/txns/618BnrTHubj9MmjhRqUddKLNwR7DZZEFEkEE3X85jXK3), [unstake](https://testnet.nearblocks.io/txns/Dy39yZdE5ak2dStqQMyttceSLLhT1xsboR4ZuR5Eh5sZ), [withdrawal](https://testnet.nearblocks.io/txns/J9SHqX7yVjtUGdp3Ndbr6WEPbSN5UM7HAvnEfdCT732z) |
| `Swap 0.1 NEAR for USDT` | Ref Finance delivered 0.474829 Test USDT; receipt output matched the agent balance increment | [DEX swap](https://testnet.nearblocks.io/txns/F5yzBy3tBd5MsM561nJAvNFCPQEABhwQN65wFRB7eZEf) |
| `Swap 0.1 USDT for NEAR` | Ref Finance delivered 0.021753018819680804033633 wrapped NEAR, then KORD withdrew it as native NEAR | [DEX swap](https://testnet.nearblocks.io/txns/9McpDHJZjNL9qdk7GVwTv83egnSEwrhj6WH6bjjuG9C3), [native withdrawal](https://testnet.nearblocks.io/txns/4AtJ5LKoQRBChdEJZLCsbwFzeJ1CmXt8R6oaNjZF5b8i) |

The deployed vault source is in `staking-contract/`: [deployment receipt](https://testnet.nearblocks.io/txns/DFxCh5QBfs42fEbX8447Z2f9GGoVgEFhGQFFFwFjL5m8). Ref Finance liquidity was funded on-chain: [liquidity receipt](https://testnet.nearblocks.io/txns/Az2oBebT2zPj9kPzQPhG1zXhNd5e4SEcDLCEARTdyPBz). These are recorded historical checks, separate from the commands a judge runs against current providers. This prototype uses local deterministic specialists with free public research and actual testnet settlement.

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
