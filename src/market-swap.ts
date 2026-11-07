import { units, decimal } from './amounts.js';
import type { NearConfig } from './near.js';
import { loadPublicPage, type SourceLoader } from './public-sources.js';

export const MARKET_PRICE_SOURCE = 'https://api.ref.finance/list-token-price';
export const MARKET_QUOTE_LIFETIME_MS = 60_000;

export interface MarketSwapQuote {
  amountIn: string;
  expectedOutput: string;
  minOutput: string;
  outputDecimals: number;
  nearPriceUsd: string;
  usdtPriceUsd: string;
  priceSource: string;
  quotedAt: string;
  expiresAt: string;
}

/** Copies an observed mainnet price into a testnet treasury payout. No mainnet assets are traded. */
export class TestnetMarketSwap {
  constructor(private cfg: NearConfig, private load: SourceLoader = loadPublicPage) {}

  async quote(asset: 'NEAR' | 'USDT', value: unknown, minimum?: string): Promise<MarketSwapQuote> {
    if (this.cfg.network !== 'testnet') throw new Error('Market-reference swaps support testnet settlement only.');
    const amount = units(value, asset === 'NEAR' ? 24 : 6);
    if (asset === 'NEAR' && (amount < units('0.1', 24) || amount > units('20', 24))) throw new Error('Swap size must be between 0.1 and 20 NEAR.');
    if (asset === 'USDT' && amount > units('100', 6)) throw new Error('Swap exceeds the 100 Test USDT limit.');

    let page;
    try { page = await this.load(MARKET_PRICE_SOURCE); }
    catch { throw new Error('Live NEAR/USDT price unavailable. No swap was submitted; try again when the price feed is available.'); }
    const observedAt = Date.parse(page.retrievedAt);
    if (!Number.isFinite(observedAt) || Date.now() - observedAt >= MARKET_QUOTE_LIFETIME_MS || observedAt > Date.now() + 5000) {
      throw new Error('Live NEAR/USDT price is stale. Refresh the quote before swapping.');
    }

    let nearPrice: bigint, usdtPrice: bigint;
    try {
      const prices = JSON.parse(page.body);
      nearPrice = units(prices['wrap.near']?.price, 18);
      usdtPrice = units(prices['usdt.tether-token.near']?.price, 18);
    } catch { throw new Error('Live NEAR/USDT price feed is invalid. No swap was submitted.'); }

    // Preserve token units throughout: NEAR has 24 decimals and Test USDT has six.
    // Use both observed prices rather than assuming USDT is exactly one dollar.
    const output = asset === 'NEAR'
      ? amount * nearPrice / (usdtPrice * 10n ** 18n)
      : amount * usdtPrice * 10n ** 18n / nearPrice;
    if (output <= 0n) throw new Error('Swap is too small to receive one output token unit.');
    const outputDecimals = asset === 'NEAR' ? 6 : 24;
    const floor = minimum !== undefined ? units(minimum, outputDecimals) : output * 98n / 100n;
    if (floor <= 0n || output < floor) throw new Error('Swap output is below your minimum. Refresh the market quote.');
    return {
      amountIn: amount.toString(), expectedOutput: output.toString(), minOutput: floor.toString(), outputDecimals,
      nearPriceUsd: decimal(nearPrice, 18), usdtPriceUsd: decimal(usdtPrice, 18), priceSource: page.url,
      quotedAt: page.retrievedAt, expiresAt: new Date(observedAt + MARKET_QUOTE_LIFETIME_MS).toISOString(),
    };
  }
}
