import { describe, it, expect, vi } from 'vitest';
import { AgentSwapService } from '../src/swap.js';

describe('testnet demonstration quotes', () => {
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
