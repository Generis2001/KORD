import { describe, expect, it } from "vitest";
import {
  assertNetworkSafety,
  assertTestnet,
  getExplorerTxUrl,
  parseEscrowEvents,
  DEFAULT_MAINNET_CONFIRMATION,
} from "../src/near.js";

const ev = (event: string) => `EVENT_JSON:${JSON.stringify({ standard: "mandate_escrow", version: "1.0.0", event, data: {} })}`;
const res = (...logs: string[]) => ({ receipts_outcome: [{ outcome: { logs } }] });

describe("escrow event parsing", () => {
  it("confirms only when payment_confirmed is present", () => {
    expect(parseEscrowEvents(res(ev("payment_authorized"), ev("payment_confirmed")))).toEqual({ confirmed: true, failed: false });
  });
  it("flags payment_failed", () => {
    expect(parseEscrowEvents(res(ev("payment_authorized"), ev("payment_failed")))).toEqual({ confirmed: false, failed: true });
  });
  it("does not confirm on authorization alone, junk logs, or other standards", () => {
    const other = `EVENT_JSON:${JSON.stringify({ standard: "nep141", event: "payment_confirmed" })}`;
    expect(parseEscrowEvents(res(ev("payment_authorized"), "garbage", "EVENT_JSON:{bad", other))).toEqual({ confirmed: false, failed: false });
    expect(parseEscrowEvents({})).toEqual({ confirmed: false, failed: false });
  });
});

describe("testnet-only guard (backward compatibility)", () => {
  const ok = { network: "testnet", rpcUrl: "https://test.rpc.fastnear.com", accountId: "me.testnet" };
  it("accepts testnet", () => expect(() => assertTestnet(ok)).not.toThrow());
  it("rejects mainnet network, .near accounts, and mainnet RPC urls", () => {
    expect(() => assertTestnet({ ...ok, network: "mainnet" })).toThrow(/testnet-only/);
    expect(() => assertTestnet({ ...ok, accountId: "me.near" })).toThrow(/not a .testnet/);
    expect(() => assertTestnet({ ...ok, rpcUrl: "https://rpc.mainnet.near.org" })).toThrow(/mainnet/);
    expect(() => assertTestnet({ ...ok, rpcUrl: "https://free.rpc.fastnear.com" })).toThrow(/mainnet/);
  });
});

describe("network safety validation & mainnet guard", () => {
  const validTestnet = {
    network: "testnet",
    rpcUrl: "https://test.rpc.fastnear.com",
    accountId: "treasury.testnet",
  };

  const validMainnet = {
    network: "mainnet",
    rpcUrl: "https://free.rpc.fastnear.com",
    accountId: "treasury.near",
    allowMainnet: true,
    mainnetConfirmation: DEFAULT_MAINNET_CONFIRMATION,
  };

  it("permits valid testnet configuration", () => {
    expect(() => assertNetworkSafety(validTestnet)).not.toThrow();
  });

  it("rejects testnet when using a .near mainnet account or mainnet RPC", () => {
    expect(() => assertNetworkSafety({ ...validTestnet, accountId: "treasury.near" })).toThrow(/mainnet/);
    expect(() => assertNetworkSafety({ ...validTestnet, rpcUrl: "https://rpc.mainnet.near.org" })).toThrow(/mainnet/);
  });

  it("blocks mainnet when ALLOW_MAINNET is missing or false", () => {
    expect(() => assertNetworkSafety({ ...validMainnet, allowMainnet: false })).toThrow(/MAINNET SAFETY LOCK/);
    expect(() => assertNetworkSafety({ ...validMainnet, allowMainnet: undefined })).toThrow(/MAINNET SAFETY LOCK/);
  });

  it("blocks mainnet when confirmation phrase is missing or incorrect", () => {
    expect(() => assertNetworkSafety({ ...validMainnet, mainnetConfirmation: undefined })).toThrow(/confirmation phrase/i);
    expect(() => assertNetworkSafety({ ...validMainnet, mainnetConfirmation: "wrong_phrase" })).toThrow(/confirmation phrase/i);
  });

  it("blocks mainnet when account is a .testnet account", () => {
    expect(() => assertNetworkSafety({ ...validMainnet, accountId: "treasury.testnet" })).toThrow(/\.testnet account/);
  });

  it("blocks mainnet when RPC url points to testnet", () => {
    expect(() => assertNetworkSafety({ ...validMainnet, rpcUrl: "https://test.rpc.fastnear.com" })).toThrow(/looks like testnet/);
  });

  it("allows properly authorized and configured mainnet", () => {
    expect(() => assertNetworkSafety(validMainnet)).not.toThrow();
  });

  it("generates correct explorer transaction URLs for each network", () => {
    expect(getExplorerTxUrl("testnet", "abc123")).toBe("https://explorer.testnet.near.org/transactions/abc123");
    expect(getExplorerTxUrl("mainnet", "abc123")).toBe("https://nearblocks.io/txns/abc123");
  });
});
