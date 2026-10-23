import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "../src/db.js";
import {
  AgentSwapService,
  DEMO_EXCHANGE_RATE,
  MAX_SWAP_PER_TRANSACTION_NEAR,
  MIN_SWAP_PER_TRANSACTION_NEAR,
  TEST_USDT_TOKEN_ID,
  TEST_USDT_DECIMALS
} from "../src/swap.js";

describe("Agent Swap & Payout Policy & Validation Tests", () => {
  let store: Store;

  beforeEach(() => {
    store = new Store(":memory:");
  });

  it("calculates correct exchange output based on demo rate and token decimals", () => {
    const inputNear = 2.5;
    const expectedOutputUsdt = inputNear * DEMO_EXCHANGE_RATE;
    expect(expectedOutputUsdt).toBe(12.5);

    // Verify 6-decimal microUSDT representation
    const microUnits = BigInt(Math.round(expectedOutputUsdt * Math.pow(10, TEST_USDT_DECIMALS)));
    expect(microUnits).toBe(12500000n);
  });

  it("rejects swap amounts below minimum limit or negative/zero", async () => {
    const svc = new AgentSwapService();
    await expect(svc.getQuote(0)).rejects.toThrow("Input NEAR amount must be greater than zero.");
    await expect(svc.getQuote(-5)).rejects.toThrow("Input NEAR amount must be greater than zero.");
    await expect(svc.getQuote(0.01)).rejects.toThrow(
      `Input NEAR amount must be at least ${MIN_SWAP_PER_TRANSACTION_NEAR} NEAR.`
    );
  });

  it("rejects swap amounts above maximum per-transaction cap", async () => {
    const svc = new AgentSwapService();
    const excessiveAmount = MAX_SWAP_PER_TRANSACTION_NEAR + 5;
    await expect(svc.getQuote(excessiveAmount)).rejects.toThrow(
      `Input NEAR amount exceeds the maximum single-swap limit of ${MAX_SWAP_PER_TRANSACTION_NEAR} NEAR.`
    );
  });

  it("rejects invalid destination wallet formats", async () => {
    const svc = new AgentSwapService();
    store.fundUserBalance("alice.testnet", 10, "Initial deposit");

    await expect(
      svc.executeSwap(
        {
          userAccount: "alice.testnet",
          inputNear: 2,
          destinationWallet: "invalid wallet address!!!"
        },
        store
      )
    ).rejects.toThrow("Invalid destination wallet account ID.");
  });

  it("rejects swap when user treasury balance is insufficient", async () => {
    const svc = new AgentSwapService();
    // Default account has 10 NEAR quota. Requesting 15 NEAR will breach available balance
    await expect(
      svc.executeSwap(
        {
          userAccount: "bob.testnet",
          inputNear: 15.0,
          destinationWallet: "bob.testnet"
        },
        store
      )
    ).rejects.toThrow(/Insufficient treasury balance/);
  });

  it("rejects swap when slippage minimum output exceeds calculated output", async () => {
    const svc = new AgentSwapService();

    // 2 NEAR at 5.0 rate gives 10.0 USDT. If minOutputUsdt requested is 15.0 USDT, it must reject
    await expect(
      svc.executeSwap(
        {
          userAccount: "charlie.testnet",
          inputNear: 2.0,
          minOutputUsdt: 15.0,
          destinationWallet: "charlie.testnet"
        },
        store
      )
    ).rejects.toThrow(/Slippage breach/);
  });

  it("persists swap records in database and maintains state history", () => {
    const swapId = "swap-unit-test-1";
    store.createSwapRecord({
      id: swapId,
      userAccount: "alice.testnet",
      agentAccount: "mandate-generis-analyst.testnet",
      inputNear: 3.0,
      outputToken: TEST_USDT_TOKEN_ID,
      outputAmount: 15.0,
      minOutputAmount: 14.7,
      exchangeRate: 5.0,
      destinationWallet: "alice.testnet",
      status: "funding_confirmed",
      note: "Test swap execution"
    });

    const record = store.getSwapRecord(swapId);
    expect(record).not.toBeNull();
    expect(record?.inputNear).toBe(3.0);
    expect(record?.outputAmount).toBe(15.0);
    expect(record?.status).toBe("funding_confirmed");

    // Update status to payout_confirmed
    store.updateSwapRecord(swapId, {
      status: "payout_confirmed",
      payoutTxHash: "mock-tx-hash-12345"
    });

    const updated = store.getSwapRecord(swapId);
    expect(updated?.status).toBe("payout_confirmed");
    expect(updated?.payoutTxHash).toBe("mock-tx-hash-12345");

    // List swaps
    const list = store.listSwaps("alice.testnet");
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].id).toBe(swapId);
  });

  it("deducts treasury balance accurately upon successful swap deduction", () => {
    // Initial user account has default 10.0 NEAR
    const initialBal = store.getUserBalance("david.testnet");
    expect(initialBal).toBe(10.0);

    const afterBal = store.deductUserBalance(
      "david.testnet",
      2.5,
      "Swap 2.5 NEAR for Test USDT",
      "mock-tx-payout"
    );
    expect(afterBal).toBe(7.5);
    expect(store.getUserBalance("david.testnet")).toBe(7.5);
  });
});
