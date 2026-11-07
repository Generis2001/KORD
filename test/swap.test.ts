import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentSwapService } from '../src/swap.js';
import * as publicSources from '../src/public-sources.js';
import { MARKET_PRICE_SOURCE } from '../src/market-swap.js';

describe('testnet demonstration quotes', () => {
  beforeEach(() => vi.stubEnv('SWAP_MODE', 'legacy_demo'));
  afterEach(() => vi.unstubAllEnvs());
  it.each([0, -5, Infinity, NaN])('rejects invalid amount %s before RPC', async amount => {
    await expect(new AgentSwapService().getQuote(amount)).rejects.toThrow('greater than zero');
  });
  it('enforces swap bounds before RPC', async () => {
    const service = new AgentSwapService();
    await expect(service.getQuote(0.01)).rejects.toThrow('at least 0.1');
    await expect(service.getQuote(25)).rejects.toThrow('limit of 20');
  });
  it('uses real pool liquidity and token storage in a quote', async () => {
    const service = new AgentSwapService();
    vi.spyOn(service, 'getTokenBalance').mockResolvedValue(125);
    vi.spyOn(service, 'isAccountRegistered').mockResolvedValue(false);
    const quote = await service.getQuote(2, 'alice.testnet');
    expect(quote).toMatchObject({ outputUsdt: 10, minOutputUsdt: 9.8, poolLiquidityUsdt: 125, storageDepositRequired: true, rateType: 'demonstration_rate' });
  });
  it('surfaces a liquidity RPC failure without inventing a zero balance', async () => {
    const service = new AgentSwapService();
    vi.spyOn(service, 'getTokenBalance').mockRejectedValue(new Error('RPC offline'));
    await expect(service.getQuote(2)).rejects.toThrow('RPC offline');
  });
});

describe('market-reference swap quotes', () => {
  beforeEach(() => {
    vi.stubEnv('SWAP_MODE', '');
    vi.stubEnv('NEAR_NETWORK', 'testnet');
    vi.stubEnv('NEAR_ACCOUNT_ID', 'treasury.testnet');
    vi.stubEnv('NEAR_PRIVATE_KEY', 'test-only-unused-quote-key');
    vi.spyOn(publicSources, 'loadPublicPage').mockResolvedValue({ url: MARKET_PRICE_SOURCE, contentType: 'application/json',
      retrievedAt: new Date().toISOString(), body: JSON.stringify({ 'wrap.near': { price: '3' }, 'usdt.tether-token.near': { price: '1' } }) });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  function service() {
    const quote = new AgentSwapService();
    vi.spyOn(quote as any, 'view').mockResolvedValue({ decimals: 6 });
    vi.spyOn(quote, 'getTokenBalance').mockResolvedValue(100);
    vi.spyOn(quote, 'isAccountRegistered').mockResolvedValue(true);
    return quote;
  }
  it('exposes an exact six-decimal market equivalent and its source to the swap panel', async () => {
    expect(await service().getQuote('0.1', 'agent.testnet')).toMatchObject({
      outputUsdt: 0.3, outputUsdtExact: '0.300000', minOutputUsdtExact: '0.294000', feeBps: 0,
      rateType: 'market_reference_testnet', priceSource: MARKET_PRICE_SOURCE, storageDepositRequired: false,
    });
  });
  it('keeps the original NEAR input string and rejects malformed inputs', async () => {
    const quote = service();
    expect((await quote.getQuote('0.100000333333333333333333')).inputNearExact).toBe('0.100000333333333333333333');
    await expect(quote.getQuote('0.1junk')).rejects.toThrow('greater than zero');
  });
  it('blocks an unverifiable token balance with a message the swap panel can display', async () => {
    const quote = service();
    vi.mocked(quote.getTokenBalance).mockRejectedValue(new Error('fetch failed'));
    await expect(quote.getQuote('0.1')).rejects.toThrow('Testnet token balances are unavailable');
  });
});
