# Mandate submission copy

Project: **Mandate — Your intent, in motion.**

Repository: https://github.com/Generis2001/mandate

Hosted testnet demo: https://mandateme.vercel.app

License: [MIT](LICENSE)

## Requested tracks

| Track | Official ID |
| --- | --- |
| Unstoppable DeFi | `defi` |
| Agent Economy | `agents` |
| Autonomous Business | `business` |

The requested track array is `["defi", "agents", "business"]`. Use these three tracks in the submission, README, GitHub About text, and demo description.

## Short description

Mandate is an onchain workspace on NEAR for DeFi treasury operations, specialist-agent payments, and autonomous business research within spending limits the user controls.

## Project description

Businesses need to turn directives into verified work and payments without giving an agent unrestricted access to their funds. Mandate combines a separate agent treasury, specialist research, evidence verification, approved payees, and budget-limited NEAR escrow in one workspace.

For Unstoppable DeFi, users deposit, withdraw, swap, send, stake, unstake, and collect matured funds through natural-language commands and wallet controls. Default swaps copy a live NEAR/USDT market reference into actual testnet treasury payouts; an explicit Ref Finance mode executes reserve-based pool trades. Quotes show their rate, source, minimum received, and expiry, while confirmations show the exact token amount and transaction receipt.

For Agent Economy, local specialists retrieve, analyze, and verify public-source evidence. An explicitly requested and authorized research fee releases to the approved researcher through NEAR escrow after verification. The contract enforces its budget, per-agent cap, approved recipients, verifier authority, and one payment per task.

For Autonomous Business, a research or procurement directive becomes a cited deliverable with visible specialist steps, verification results, and optional payment. The user controls the funding, approved payees, and spending constraints. The conversation and settlement ledger preserve the result and on-chain receipts.

This is a NEAR testnet prototype. Test USDT is a faucet asset, the backend controls the agent signing keys, and general wallet restrictions run on the server. There is no cross-chain NEAR Intents execution or claim of confidential inference. Each user-issued financial action needs wallet authorization; the approved research workflow and matured unstake collection then follow the documented flow.

## Demo sequence

1. Connect Meteor Wallet, authorize the linked account, and deposit testnet NEAR into the agent wallet.
2. Open Swap tokens. Show the live rate and quote for 0.1 NEAR, then the six-decimal received Test USDT amount and explorer receipt.
3. Request a business research or supplier comparison and expand the specialist steps and cited evidence.
4. Request research with an explicit small NEAR fee. Show verification, escrow release, the paid researcher, and the settlement receipt.
5. Demonstrate an unapproved payee or a spending-limit rejection, then reopen the saved conversation and ledger.

The public demo post should identify NEAR HACKATHON, include @NEARProtocol and #NEARHackathon, and link the recording, repository, and hosted demo. Keep the recorded swap rate and amount consistent with the actual quote shown during the recording.

## Existing submission changes

The official [change-request page](https://nearhackathon.com/request-changes) handles updates to an existing submission. Select Tracks and request **Unstoppable DeFi, Agent Economy, and Autonomous Business**. Organizers review requests manually; updating this repository does not itself change the saved application. If the request has already been sent, wait for its application rather than submitting another application.

This document contains public project copy, not a submission payload or a record that the organizers have applied the track change. Check the live [hackathon instructions](https://nearhackathon.com/HACKATHON.md) before completing a submission or change request.
