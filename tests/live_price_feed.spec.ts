import { describe, it, expect } from 'vitest';
import { LivePriceFeed } from '../src/core/live_price_feed.js';

describe('LivePriceFeed Core Precision & Normalization', () => {
  it('parses fractional prices to micro-USD without floating point inaccuracies', () => {
    // $89.21000000 -> 89_210_000n
    expect(LivePriceFeed.parsePriceToMicroUsd('89.21000000')).toBe(89_210_000n);
    // $75,837.66000000 -> 75_837_660_000n
    expect(LivePriceFeed.parsePriceToMicroUsd('75837.66000000')).toBe(75_837_660_000n);
    // $0.001234 -> 1234n
    expect(LivePriceFeed.parsePriceToMicroUsd('0.001234')).toBe(1234n);
    // $1.5 -> 1_500_000n
    expect(LivePriceFeed.parsePriceToMicroUsd('1.5')).toBe(1_500_000n);
    // Exact $100 -> 100_000_000n
    expect(LivePriceFeed.parsePriceToMicroUsd('100')).toBe(100_000_000n);
  });

  it('instantiates cleanly and supports registering price listeners', () => {
    const feed = new LivePriceFeed();
    let tickReceived = false;
    feed.onPriceTick((tick) => {
      if (tick.symbol === 'SOLUSDT') tickReceived = true;
    });

    expect(feed.getLatestPrice('SOL')).toBeNull();
    feed.stop();
  });
});
