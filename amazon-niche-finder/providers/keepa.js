/**
 * Keepa API Provider
 * Docs: https://keepa.com/#!discuss/t/using-the-keepa-api/47
 *
 * Fetches Amazon product data, price history, and sales rank
 * information for niche analysis.
 */
export class KeepaProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.keepa.com';
  }

  getDomainId(marketplace) {
    const domains = {
      us: 1, uk: 2, de: 3, fr: 4, ca: 6, it: 8, es: 9,
    };
    return domains[marketplace] || 2; // Default UK
  }

  async fetchApi(endpoint, params = {}) {
    if (!this.apiKey) {
      throw new Error('Keepa API key not configured. Set KEEPA_API_KEY in your environment.');
    }

    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set('key', this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Keepa API error (${response.status}): ${text}`);
    }
    return response.json();
  }

  async searchNiche(keyword, marketplace = 'uk') {
    const domainId = this.getDomainId(marketplace);

    // 1. Search for products
    const searchData = await this.fetchApi('/search', {
      domain: domainId,
      type: 'product',
      term: keyword,
      page: 0,
      perPage: 50,
    });

    const asins = (searchData.asinList || []).slice(0, 50);

    if (asins.length === 0) {
      return {
        keyword,
        marketplace,
        monthlySearchVolume: 0,
        products: [],
        totalResults: 0,
        searchTimestamp: new Date().toISOString(),
      };
    }

    // 2. Get product details for found ASINs
    const productData = await this.fetchApi('/product', {
      domain: domainId,
      asin: asins.join(','),
      stats: 30, // 30-day stats
      history: 0,
    });

    const products = (productData.products || []).map((p, idx) => {
      const currentPrice = this.extractCurrentPrice(p);
      const monthlySales = this.estimateMonthlySales(p.salesRankReference, p.categoryTree?.[0]?.name);

      return {
        asin: p.asin,
        title: p.title,
        price: currentPrice,
        currency: marketplace === 'uk' ? 'GBP' : 'USD',
        rating: p.csv?.[16]?.[p.csv[16]?.length - 1] / 10 || null, // Rating in Keepa format
        reviewCount: p.csv?.[17]?.[p.csv[17]?.length - 1] || 0,
        position: idx + 1,
        image: p.imagesCSV ? `https://images-na.ssl-images-amazon.com/images/I/${p.imagesCSV.split(',')[0]}` : null,
        salesRank: p.salesRankReference || null,
        category: p.categoryTree?.[0]?.name || null,
        isPrime: true,
        isFba: p.fbaFees != null,
        estimatedMonthlySales: monthlySales,
        estimatedMonthlyRevenue: currentPrice ? monthlySales * currentPrice : null,
        // Keepa-specific: sales rank history for seasonality
        salesRankDrops30: p.stats?.salesRankDrops30 || 0,
        salesRankDrops90: p.stats?.salesRankDrops90 || 0,
        salesRankDrops180: p.stats?.salesRankDrops180 || 0,
      };
    });

    // Estimate search volume from product metrics
    const monthlySearchVolume = this.estimateSearchVolume(products);

    return {
      keyword,
      marketplace,
      monthlySearchVolume,
      products,
      totalResults: searchData.totalResults || products.length,
      searchTimestamp: new Date().toISOString(),
    };
  }

  extractCurrentPrice(product) {
    // Try Amazon price first, then new offers
    const amazonPriceHistory = product.csv?.[0];
    const newPriceHistory = product.csv?.[1];

    if (amazonPriceHistory?.length >= 2) {
      const lastPrice = amazonPriceHistory[amazonPriceHistory.length - 1];
      if (lastPrice > 0) return lastPrice / 100; // Keepa stores prices in cents
    }

    if (newPriceHistory?.length >= 2) {
      const lastPrice = newPriceHistory[newPriceHistory.length - 1];
      if (lastPrice > 0) return lastPrice / 100;
    }

    return null;
  }

  estimateSearchVolume(products) {
    if (!products.length) return 0;
    const avgReviews = products.reduce((sum, p) => sum + (p.reviewCount || 0), 0) / products.length;
    return Math.round(avgReviews * 30);
  }

  estimateMonthlySales(bsr, category) {
    if (!bsr) return 0;
    if (bsr <= 100) return Math.round(3000 / (bsr * 0.1 + 1));
    if (bsr <= 1000) return Math.round(1500 / (bsr * 0.01 + 1));
    if (bsr <= 10000) return Math.round(800 / (bsr * 0.001 + 1));
    if (bsr <= 100000) return Math.round(200 / (bsr * 0.0001 + 1));
    return Math.round(50 / (bsr * 0.00001 + 1));
  }
}
