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

  async searchNiche(keyword, marketplace = 'uk', maxPages = 10) {
    const amazonDomain = this.getAmazonDomain(marketplace);

    // 1. Fetch up to maxPages of search results (1 credit per page)
    let allProducts = [];
    let totalResults = 0;

    for (let page = 1; page <= maxPages; page++) {
      const searchResults = await this.fetchApi({
        type: 'search',
        amazon_domain: amazonDomain,
        search_term: keyword,
        page: String(page),
      });

      const pageProducts = searchResults.search_results || [];
      totalResults = searchResults.pagination?.total_results || totalResults;

      if (pageProducts.length === 0) break; // No more results

      allProducts.push(...pageProducts);

      // Stop early if we've fetched all available results
      const totalPages = searchResults.pagination?.total_pages || maxPages;
      if (page >= totalPages) break;
    }

    // 2. Get search volume / keyword data (1 credit)
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

    // Extract product data
    const products = allProducts.map(p => ({
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

    // Deduplicate by ASIN
    const seen = new Set();
    const uniqueProducts = products.filter(p => {
      if (!p.asin || seen.has(p.asin)) return false;
      seen.add(p.asin);
      return true;
    });

    // Extract monthly search volume
    const monthlySearchVolume = searchVolume?.search_volume?.exact?.[0]?.volume
      || searchVolume?.search_volume
      || this.estimateSearchVolume(uniqueProducts);

    // Estimate monthly sales per product using BSR if available
    const productsWithSales = uniqueProducts.map(p => ({
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
      totalResults: totalResults || uniqueProducts.length,
      pagesScanned: Math.min(maxPages, Math.ceil(allProducts.length / 15)),
      searchTimestamp: new Date().toISOString(),
    };
  }

  /**
   * Search by Amazon category/browse node ID.
   * Fetches bestsellers within a category to analyse the niche.
   */
  async searchCategory(categoryId, categoryName, marketplace = 'uk', maxPages = 10) {
    const amazonDomain = this.getAmazonDomain(marketplace);

    let allProducts = [];
    let totalResults = 0;

    for (let page = 1; page <= maxPages; page++) {
      const searchResults = await this.fetchApi({
        type: 'category',
        amazon_domain: amazonDomain,
        category_id: categoryId,
        page: String(page),
      });

      const pageProducts = searchResults.category_results || [];
      totalResults = searchResults.pagination?.total_results || totalResults;

      if (pageProducts.length === 0) break;

      allProducts.push(...pageProducts);

      const totalPages = searchResults.pagination?.total_pages || maxPages;
      if (page >= totalPages) break;
    }

    const products = allProducts.map(p => ({
      asin: p.asin,
      title: p.title,
      price: p.price?.value || null,
      currency: p.price?.currency || 'GBP',
      rating: p.rating || null,
      reviewCount: p.ratings_total || 0,
      position: p.position,
      image: p.image,
      salesRank: p.bestsellers_rank?.[0]?.rank || null,
      category: p.bestsellers_rank?.[0]?.category || categoryName,
      isPrime: p.is_prime || false,
      isFba: p.fulfillment?.is_fulfilled_by_amazon || false,
    }));

    const seen = new Set();
    const uniqueProducts = products.filter(p => {
      if (!p.asin || seen.has(p.asin)) return false;
      seen.add(p.asin);
      return true;
    });

    const monthlySearchVolume = this.estimateSearchVolume(uniqueProducts);

    const productsWithSales = uniqueProducts.map(p => ({
      ...p,
      estimatedMonthlySales: this.estimateMonthlySales(p.salesRank, p.category),
      estimatedMonthlyRevenue: p.price
        ? this.estimateMonthlySales(p.salesRank, p.category) * p.price
        : null,
    }));

    return {
      keyword: categoryName,
      categoryId,
      marketplace,
      monthlySearchVolume,
      products: productsWithSales,
      totalResults: totalResults || uniqueProducts.length,
      pagesScanned: Math.min(maxPages, Math.ceil(allProducts.length / 15)),
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
