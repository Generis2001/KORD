import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestnetMarketSwap, MARKET_PRICE_SOURCE } from '../src/market-swap.js';
import { receivedSwapAmount, swapMode } from '../src/swap.js';
import { units } from '../src/amounts.js';
import type { WalletOperation } from '../src/wallet-store.js';

const cfg = { network: 'testnet', rpcUrl: 'http://localhost:3999', accountId: 'treasury.testnet', privateKey: '', yoctoPerCent: 1n };
const page = (near = '3.71', usdt = '0.999177', retrievedAt = new Date().toISOString()) => ({
  url: MARKET_PRICE_SOURCE, contentType: 'application/json', retrievedAt,
  body: JSON.stringify({ 'wrap.near': { price: near }, 'usdt.tether-token.near': { price: usdt } }),
});
afterEach(() => vi.unstubAllEnvs());

describe('market-reference testnet swaps', () => {
  it('prices 0.1 NEAR at the observed equivalent instead of the testnet pool rate', async () => {
    const load = vi.fn().mockResolvedValue(page());
    const quote = await new TestnetMarketSwap(cfg, load).quote('NEAR', '0.1');
    expect(load).toHaveBeenCalledWith(MARKET_PRICE_SOURCE);
    expect(quote).toMatchObject({ expectedOutput: '371305', minOutput: '363878', outputDecimals: 6 });
    expect(Date.parse(quote.expiresAt) - Date.parse(quote.quotedAt)).toBe(60_000);
  });
  it('uses both token prices in both directions rather than a fixed dollar peg', async () => {
    const service = new TestnetMarketSwap(cfg, vi.fn().mockResolvedValue(page('3', '0.99')));
    expect((await service.quote('NEAR', '0.1')).expectedOutput).toBe('303030');
    expect((await service.quote('USDT', '0.3')).expectedOutput).toBe(units('0.099', 24).toString());
  });
  it('preserves NEAR precision and rounds down only the final USDT token unit', async () => {
    const service = new TestnetMarketSwap(cfg, vi.fn().mockResolvedValue(page('3', '1')));
    const quote = await service.quote('NEAR', '0.100000333333333333333333');
    expect(quote.amountIn).toBe('100000333333333333333333');
    expect(quote.expectedOutput).toBe('300000');
  });
  it('rejects output below an explicit minimum', async () => {
    const service = new TestnetMarketSwap(cfg, vi.fn().mockResolvedValue(page('3', '1')));
    await expect(service.quote('NEAR', '0.1', '0.31')).rejects.toThrow('minimum');
    await expect(service.quote('NEAR', '0.1', '0')).rejects.toThrow('greater than zero');
    expect((await service.quote('NEAR', '0.1', '0.3')).minOutput).toBe('300000');
  });
  it.each(['0', '-3', 'NaN', 'Infinity', '1e3', 'missing'])('rejects invalid price %s without substituting a rate', async price => {
    await expect(new TestnetMarketSwap(cfg, vi.fn().mockResolvedValue(page(price))).quote('NEAR', '0.1')).rejects.toThrow('invalid');
  });
  it('blocks stale and unavailable prices and mainnet settlement', async () => {
    const stale = page('3', '1', new Date(Date.now() - 61_000).toISOString());
    await expect(new TestnetMarketSwap(cfg, vi.fn().mockResolvedValue(stale)).quote('NEAR', '0.1')).rejects.toThrow('stale');
    await expect(new TestnetMarketSwap(cfg, vi.fn().mockRejectedValue(new Error('offline'))).quote('NEAR', '0.1')).rejects.toThrow('unavailable');
    await expect(new TestnetMarketSwap({ ...cfg, network: 'mainnet' }).quote('NEAR', '0.1')).rejects.toThrow('testnet');
  });
  it('uses live market pricing by default and requires an explicit alternative mode', () => {
    vi.stubEnv('SWAP_MODE', '');
    expect(swapMode()).toBe('market');
    vi.stubEnv('SWAP_MODE', 'ref');
    expect(swapMode()).toBe('ref');
    vi.stubEnv('SWAP_MODE', 'typo');
    expect(swapMode).toThrow('SWAP_MODE');
  });
});

describe('received swap amounts', () => {
  it('reports the confirmed six-decimal payout and hides a pending payout', async () => {
    const quote = await new TestnetMarketSwap(cfg, vi.fn().mockResolvedValue(page('3', '1'))).quote('NEAR', '0.1');
    const op: WalletOperation = { id: 'market-operation', userAccount: 'alice.testnet', action: 'swap', asset: 'NEAR', amount: '0.1',
      status: 'confirmed', txHashes: ['payout'], createdAt: quote.quotedAt, market: { ...quote, actualOutput: '300000' } };
    expect(receivedSwapAmount(op)).toBe('0.300000');
    expect(receivedSwapAmount({ ...op, status: 'needs_review' })).toBeNull();
    expect(receivedSwapAmount({ ...op, market: quote })).toBeNull();
  });
  it('does not fabricate an output for an unconfirmed historical fixed-rate swap', () => {
    const op: WalletOperation = { id: 'old-operation', userAccount: 'alice.testnet', action: 'swap', asset: 'NEAR', amount: '0.1',
      status: 'needs_review', txHashes: ['funding'], createdAt: new Date().toISOString() };
    expect(receivedSwapAmount(op)).toBeNull();
  });
});
