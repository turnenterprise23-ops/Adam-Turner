/**
 * Rainforest API Provider
 * Docs: https://www.rainforestapi.com/docs
 *
 * Fetches Amazon product search results, search volume estimates,
 * and product details for niche analysis.
 */
export class RainforestProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.rainforestapi.com/request';
  }

  getDomain(marketplace) {
    const domains = {
      uk: 'amazon.co.uk',
      us: 'amazon.com',
      de: 'amazon.de',
      fr: 'amazon.fr',
      it: 'amazon.it',
      es: 'amazon.es',
      ca: 'amazon.ca',
    };
    return domains[marketplace] || 'amazon.co.uk';
  }

  getAmazonDomain(marketplace) {
    const domains = {
      uk: 'amazon.co.uk',
      us: 'amazon.com',
      de: 'amazon.de',
      fr: 'amazon.fr',
      it: 'amazon.it',
      es: 'amazon.es',
      ca: 'amazon.ca',
    };
    return domains[marketplace] || 'amazon.co.uk';
  }

  async fetchApi(params) {
    if (!this.apiKey) {
      throw new Error('Rainforest API key not configured. Set RAINFOREST_API_KEY in your environment.');
    }

    const url = new URL(this.baseUrl);
    url.searchParams.set('api_key', this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Rainforest API error (${response.status}): ${text}`);
    }
    return response.json();
  }

  async searchNiche(keyword, marketplace = 'uk') {
    const amazonDomain = this.getAmazonDomain(marketplace);

    // 1. Search for products with this keyword
    const searchResults = await this.fetchApi({
      type: 'search',
      amazon_domain: amazonDomain,
      search_term: keyword,
      sort_by: 'relevance',
    });

    // 2. Get search volume / keyword data
    let searchVolume = null;
    try {
      searchVolume = await this.fetchApi({
        type: 'search_volume',
        amazon_domain: amazonDomain,
        search_term: keyword,
      });
    } catch {
      // search_volume endpoint may not be available on all plans
    }

    // Extract product list from search results
    const products = (searchResults.search_results || []).slice(0, 50).map(p => ({
      asin: p.asin,
      title: p.title,
      price: p.price?.value || null,
      currency: p.price?.currency || 'GBP',
      rating: p.rating || null,
      reviewCount: p.ratings_total || 0,
      position: p.position,
      image: p.image,
      salesRank: p.bestsellers_rank?.[0]?.rank || null,
      category: p.bestsellers_rank?.[0]?.category || null,
      isPrime: p.is_prime || false,
      isFba: p.fulfillment?.is_fulfilled_by_amazon || false,
    }));

    // Extract monthly search volume
    const monthlySearchVolume = searchVolume?.search_volume?.exact?.[0]?.volume
      || searchVolume?.search_volume
      || this.estimateSearchVolume(products);

    // Estimate monthly sales per product using BSR if available
    const productsWithSales = products.map(p => ({
      ...p,
      estimatedMonthlySales: this.estimateMonthlySales(p.salesRank, p.category),
      estimatedMonthlyRevenue: p.price
        ? this.estimateMonthlySales(p.salesRank, p.category) * p.price
        : null,
    }));

    return {
      keyword,
      marketplace,
      monthlySearchVolume,
      products: productsWithSales,
      totalResults: searchResults.pagination?.total_results || products.length,
      searchTimestamp: new Date().toISOString(),
    };
  }

  /**
   * Rough search volume estimate based on number of results and product metrics.
   * Used as fallback when the search_volume endpoint is unavailable.
   */
  estimateSearchVolume(products) {
    if (!products.length) return 0;
    const avgReviews = products.reduce((sum, p) => sum + (p.reviewCount || 0), 0) / products.length;
    // Very rough heuristic: avg reviews * 30 as monthly search volume proxy
    return Math.round(avgReviews * 30);
  }

  /**
   * Estimate monthly sales from BSR using a rough formula.
   * Based on commonly used BSR-to-sales estimation curves.
   */
  estimateMonthlySales(bsr, category) {
    if (!bsr) return 0;
    // Simplified estimation formula (UK market approximation)
    // Higher BSR = fewer sales
    if (bsr <= 100) return Math.round(3000 / (bsr * 0.1 + 1));
    if (bsr <= 1000) return Math.round(1500 / (bsr * 0.01 + 1));
    if (bsr <= 10000) return Math.round(800 / (bsr * 0.001 + 1));
    if (bsr <= 100000) return Math.round(200 / (bsr * 0.0001 + 1));
    return Math.round(50 / (bsr * 0.00001 + 1));
  }
}
