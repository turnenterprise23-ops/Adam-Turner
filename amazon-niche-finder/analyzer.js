/**
 * Niche Analyzer
 *
 * Takes raw product data from an API provider and evaluates it
 * against the user's criteria to determine niche viability.
 *
 * Criteria:
 *  - Leading keyword search volume: 3000+/month
 *  - Max competitors in niche: 35
 *  - Max reviews on any competitor listing: 1500
 *  - Price range: £6.99 – £39.99
 *  - Min monthly revenue: £2,500
 *  - Target margin: 25%
 *  - Seasonality: in-season at least 6 months/year
 */
export class NicheAnalyzer {

  analyze(rawData, criteria) {
    const products = rawData.products || [];

    if (products.length === 0) {
      return this.emptyResult(rawData.keyword, criteria);
    }

    // Filter to products within the price range
    const pricedProducts = products.filter(p => p.price != null && p.price > 0);

    // Core metrics
    const searchVolume = rawData.monthlySearchVolume || 0;
    const competitorCount = Math.min(products.length, rawData.totalResults || products.length);
    const pricesInRange = pricedProducts.filter(
      p => p.price >= criteria.min_price && p.price <= criteria.max_price
    );

    const avgPrice = pricedProducts.length
      ? pricedProducts.reduce((s, p) => s + p.price, 0) / pricedProducts.length
      : 0;

    const avgReviews = products.length
      ? products.reduce((s, p) => s + (p.reviewCount || 0), 0) / products.length
      : 0;

    const maxReviews = Math.max(...products.map(p => p.reviewCount || 0), 0);

    // Revenue estimation
    const revenueProducts = pricedProducts.filter(p => p.estimatedMonthlyRevenue != null);
    const avgMonthlyRevenue = revenueProducts.length
      ? revenueProducts.reduce((s, p) => s + p.estimatedMonthlyRevenue, 0) / revenueProducts.length
      : 0;

    const totalNicheRevenue = revenueProducts.reduce(
      (s, p) => s + (p.estimatedMonthlyRevenue || 0), 0
    );

    // Margin estimation (simplified: assumes ~40% COGS, ~15% Amazon fees, rest is margin)
    const estimatedMargin = this.estimateMargin(avgPrice);

    // Seasonality estimation
    const seasonalityMonths = this.estimateSeasonality(products);

    // --- Check criteria ---
    const checks = {
      searchVolume: searchVolume >= criteria.min_search_volume,
      competitors: competitorCount <= criteria.max_competitors,
      maxReviews: maxReviews <= criteria.max_reviews,
      priceRange: pricesInRange.length >= pricedProducts.length * 0.5, // At least 50% in range
      avgPriceInRange: avgPrice >= criteria.min_price && avgPrice <= criteria.max_price,
      revenue: avgMonthlyRevenue >= criteria.min_monthly_revenue,
      margin: estimatedMargin >= criteria.target_margin,
      seasonality: seasonalityMonths >= criteria.min_season_months,
    };

    const passesCriteria = Object.values(checks).every(v => v);
    const passCount = Object.values(checks).filter(v => v).length;
    const totalChecks = Object.keys(checks).length;

    // Niche score (0-100)
    const nicheScore = this.calculateScore(
      { searchVolume, competitorCount, maxReviews, avgPrice, avgMonthlyRevenue, estimatedMargin, seasonalityMonths },
      criteria
    );

    // Top competitors breakdown
    const topCompetitors = products.slice(0, 10).map(p => ({
      asin: p.asin,
      title: p.title,
      price: p.price,
      reviews: p.reviewCount,
      rating: p.rating,
      estimatedMonthlySales: p.estimatedMonthlySales,
      estimatedMonthlyRevenue: p.estimatedMonthlyRevenue,
    }));

    return {
      keyword: rawData.keyword,
      searchVolume,
      competitorCount,
      avgPrice: Math.round(avgPrice * 100) / 100,
      avgReviews: Math.round(avgReviews),
      maxReviews,
      avgMonthlyRevenue: Math.round(avgMonthlyRevenue * 100) / 100,
      totalNicheRevenue: Math.round(totalNicheRevenue * 100) / 100,
      estimatedMargin: Math.round(estimatedMargin * 10) / 10,
      seasonalityMonths,
      nicheScore: Math.round(nicheScore * 10) / 10,
      passesCriteria,
      passCount,
      totalChecks,
      checks,
      topCompetitors,
      priceDistribution: this.getPriceDistribution(pricedProducts),
      reviewDistribution: this.getReviewDistribution(products),
    };
  }

  emptyResult(keyword, criteria) {
    return {
      keyword,
      searchVolume: 0,
      competitorCount: 0,
      avgPrice: 0,
      avgReviews: 0,
      maxReviews: 0,
      avgMonthlyRevenue: 0,
      totalNicheRevenue: 0,
      estimatedMargin: 0,
      seasonalityMonths: 0,
      nicheScore: 0,
      passesCriteria: false,
      passCount: 0,
      totalChecks: 8,
      checks: {
        searchVolume: false, competitors: true, maxReviews: true,
        priceRange: false, avgPriceInRange: false, revenue: false,
        margin: false, seasonality: false,
      },
      topCompetitors: [],
      priceDistribution: {},
      reviewDistribution: {},
    };
  }

  /**
   * Estimate profit margin based on average selling price.
   * Simplified model:
   *  - Amazon referral fee: ~15%
   *  - FBA fulfillment: varies by size/weight, estimated ~20% for small items
   *  - Estimated COGS: ~25-35% of selling price
   *  - Remaining is profit margin
   */
  estimateMargin(avgPrice) {
    if (avgPrice <= 0) return 0;

    const referralFee = avgPrice * 0.15;
    const fbaFee = avgPrice < 10 ? 3.0 : avgPrice < 20 ? 4.0 : avgPrice < 30 ? 4.5 : 5.5;
    const estimatedCogs = avgPrice * 0.25;
    const profit = avgPrice - referralFee - fbaFee - estimatedCogs;
    const margin = (profit / avgPrice) * 100;

    return Math.max(margin, 0);
  }

  /**
   * Estimate how many months per year a product is "in season".
   * Uses sales rank drops and review velocity as proxies.
   * Without full 12-month data, we use heuristics based on available metrics.
   */
  estimateSeasonality(products) {
    if (products.length === 0) return 0;

    // Check if we have Keepa salesRankDrops data
    const hasDropData = products.some(p => p.salesRankDrops30 || p.salesRankDrops90 || p.salesRankDrops180);

    if (hasDropData) {
      const avgDrops30 = products.reduce((s, p) => s + (p.salesRankDrops30 || 0), 0) / products.length;
      const avgDrops180 = products.reduce((s, p) => s + (p.salesRankDrops180 || 0), 0) / products.length;

      // If consistent drops across 180 days, likely evergreen
      if (avgDrops180 > 0 && avgDrops30 > 0) {
        const consistency = (avgDrops30 * 6) / avgDrops180;
        if (consistency > 0.7) return 12; // Very consistent = year-round
        if (consistency > 0.5) return 9;
        if (consistency > 0.3) return 6;
        return 4;
      }
    }

    // Fallback: estimate from review counts and sales rank presence
    // Products with steady reviews likely sell year-round
    const avgReviews = products.reduce((s, p) => s + (p.reviewCount || 0), 0) / products.length;
    const hasSalesRank = products.filter(p => p.salesRank != null).length;
    const salesRankRatio = hasSalesRank / products.length;

    // Heuristic: more reviews + active sales rank = more months in season
    if (avgReviews > 500 && salesRankRatio > 0.8) return 12;
    if (avgReviews > 200 && salesRankRatio > 0.6) return 10;
    if (avgReviews > 100 && salesRankRatio > 0.4) return 8;
    if (avgReviews > 50) return 7;
    return 6; // Default assumption for products with some traction
  }

  /**
   * Calculate a 0-100 niche score based on how well metrics align with criteria.
   * Higher = better opportunity.
   */
  calculateScore(metrics, criteria) {
    let score = 0;
    const weights = {
      searchVolume: 20,
      competition: 20,
      reviews: 15,
      price: 10,
      revenue: 20,
      margin: 10,
      seasonality: 5,
    };

    // Search volume: more is better, up to 2x the minimum
    const svRatio = Math.min(metrics.searchVolume / criteria.min_search_volume, 2);
    score += weights.searchVolume * (svRatio / 2);

    // Competition: fewer is better
    if (metrics.competitorCount <= criteria.max_competitors) {
      const compRatio = 1 - (metrics.competitorCount / criteria.max_competitors);
      score += weights.competition * (0.5 + compRatio * 0.5);
    }

    // Reviews: lower max reviews is better (easier to compete)
    if (metrics.maxReviews <= criteria.max_reviews) {
      const revRatio = 1 - (metrics.maxReviews / criteria.max_reviews);
      score += weights.reviews * (0.5 + revRatio * 0.5);
    }

    // Price: in range gets full points
    if (metrics.avgPrice >= criteria.min_price && metrics.avgPrice <= criteria.max_price) {
      // Sweet spot is middle of range
      const mid = (criteria.min_price + criteria.max_price) / 2;
      const priceScore = 1 - Math.abs(metrics.avgPrice - mid) / (criteria.max_price - criteria.min_price);
      score += weights.price * priceScore;
    }

    // Revenue: more is better
    const revRatio = Math.min(metrics.avgMonthlyRevenue / criteria.min_monthly_revenue, 3);
    score += weights.revenue * (revRatio / 3);

    // Margin: higher is better
    const marginRatio = Math.min(metrics.estimatedMargin / criteria.target_margin, 2);
    score += weights.margin * (marginRatio / 2);

    // Seasonality: more months is better
    const seasonRatio = metrics.seasonalityMonths / 12;
    score += weights.seasonality * seasonRatio;

    return Math.min(Math.round(score * 10) / 10, 100);
  }

  getPriceDistribution(products) {
    const buckets = { 'Under £7': 0, '£7-£15': 0, '£15-£25': 0, '£25-£40': 0, 'Over £40': 0 };
    for (const p of products) {
      if (p.price < 7) buckets['Under £7']++;
      else if (p.price < 15) buckets['£7-£15']++;
      else if (p.price < 25) buckets['£15-£25']++;
      else if (p.price <= 40) buckets['£25-£40']++;
      else buckets['Over £40']++;
    }
    return buckets;
  }

  getReviewDistribution(products) {
    const buckets = { '0-50': 0, '50-200': 0, '200-500': 0, '500-1000': 0, '1000-1500': 0, '1500+': 0 };
    for (const p of products) {
      const r = p.reviewCount || 0;
      if (r < 50) buckets['0-50']++;
      else if (r < 200) buckets['50-200']++;
      else if (r < 500) buckets['200-500']++;
      else if (r < 1000) buckets['500-1000']++;
      else if (r <= 1500) buckets['1000-1500']++;
      else buckets['1500+']++;
    }
    return buckets;
  }
}
