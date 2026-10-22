# Mandate escrow contract (Rust, near-sdk 5.x)

Onchain enforcement for Mandate. The owner funds a mandate; only the designated **verifier** can release payments. The contract itself enforces:

- total budget (the attached deposit) cannot be exceeded
- per-agent cap, counted cumulatively
- recipient allowlist
- one payment per task id
- the verifier can never also be a paid agent
- state is reserved before the transfer and rolled back in a callback if the transfer fails
- after `close_mandate`, the owner can `refund_remaining` (unspent funds only, never twice)

## Status

- `cargo test`: 23 unit tests pass (limits, allowlist, double pay, verifier-only, rollback on failed transfer, refunds).
- NOT done here: wasm build, deployment, and any testnet run. The sandbox had no wasm32 target and could not reach NEAR RPC.
- The TypeScript app can call it (`DEMO_EXECUTOR=escrow`); event parsing is unit tested, the live call is not.
- Not covered by unit tests: `#[private]` on `on_payout` / `on_refund` is enforced by the generated wasm wrapper, so check it on testnet (step 5 below).
- `Cargo.lock` pins near-sdk 5.27.0 (newest that built with the Rust 1.91 used here). Newer near-sdk versions exist; if you upgrade, rerun the tests.
- Not audited. Testnet only.

## Build and deploy (testnet)

Use the current commands from https://docs.near.org/ (build with `cargo near` or `cargo build --target wasm32-unknown-unknown --release`, then deploy to a fresh testnet account and call `new`). Command syntax was not verified here.

## Verify on testnet (do all of these)

1. `create_mandate` with `{"mandate_id":"m1","verifier":"<verifier>.testnet","per_agent_cap":"<yocto>","allowed_agents":["<agent>.testnet"]}` and an attached deposit.
2. `approve_payment` as the verifier within the cap: agent balance rises, `get_mandate` shows `spent`.
3. `approve_payment` above the cap, to a non-allowlisted account, for the same task twice, and as the owner or agent: each must fail.
4. `close_mandate` then `refund_remaining` as the owner: remaining funds return once.
5. Call `on_payout` from any account other than the contract: must fail with "Method on_payout is private".
6. Save the tx hashes and open them in the testnet explorer for your README.

## Methods

| Method | Who | What |
| --- | --- | --- |
| `new` | deployer | init |
| `create_mandate` (payable) | owner | fund and configure |
| `approve_payment` | verifier only | release payment for a task |
| `close_mandate` | owner | stop further payments |
| `refund_remaining` | owner, after close | return unspent funds |
| `get_mandate`, `agent_spent`, `is_task_paid` | anyone | views |
