/**
 * Polymarket Insider Tracker — Query Layer (v4)
 * Schema-verified March 2026.
 */

export const ENDPOINTS = {
  pnl:      "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn",
  activity: "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/activity-subgraph/0.0.4/gn",
  gamma:    "/gamma",
};

export const THRESHOLDS = {
  MIN_CATEGORY_CONCENTRATION:    0.75,
  MAX_SPECIALIST_POSITION_COUNT: 50,
  MIN_SPECIALIST_PROFIT_USDC:    500,
  PNL_LEADERBOARD_SEED_COUNT:    100,
};

async function gql(endpoint, query, variables = {}) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${endpoint}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data;
}

async function rest(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function inferCategory(title) {
  if (!title || title === "Unknown") return "Unknown";
  const t = title.toLowerCase();
  if (/nba|nfl|mlb|nhl|soccer|football|basketball|baseball|hockey|epl|champions league|premier league|la liga|bundesliga|serie a|mls|fifa|world cup|match|win on|beat|vs\.|versus/.test(t)) return "Sports";
  if (/trump|biden|harris|election|president|congress|senate|republican|democrat|vote|ballot|nomination|governor|minister|parliament/.test(t)) return "Politics";
  if (/bitcoin|btc|eth|ethereum|crypto|solana|coinbase|binance|defi|token|blockchain/.test(t)) return "Crypto";
  if (/fed|federal reserve|interest rate|gdp|inflation|recession|cpi|unemployment|economy/.test(t)) return "Economics";
  if (/oscar|emmy|grammy|celebrity|taylor swift|kardashian|reality tv|survivor|bachelor|transfer/.test(t)) return "Entertainment";
  if (/covid|vaccine|virus|pandemic|fda|drug|cancer|health/.test(t)) return "Health";
  if (/ai|openai|gpt|anthropic|google|apple|microsoft|tesla|spacex|tech/.test(t)) return "Tech";
  return "Other";
}

export async function fetchObscureMarkets(limit = 50) {
  const url = `${ENDPOINTS.gamma}/markets?limit=${limit}&order=volumeNum&ascending=false&volume_num_min=100000&volume_num_max=5000000`;
  const data = await rest(url);
  return data
    .filter(m => m.clobTokenIds)
    .map(m => ({
      question: m.question,
      conditionId: m.conditionId,
      volumeNum: parseFloat(m.volumeNum),
      category: inferCategory(m.question),
      tokenIds: JSON.parse(m.clobTokenIds),
    }));
}

export async function fetchLargePositionsInMarkets(markets) {
  const tokenToMarket = {};
  for (const market of markets) {
    for (const tokenId of market.tokenIds) {
      tokenToMarket[tokenId] = market;
    }
  }

  const MIN_BOUGHT = String(25_000 * 1_000_000);
  const walletMap = new Map();

  for (const [tokenId, market] of Object.entries(tokenToMarket)) {
    const query = `
      query SingleMarketPositions($tokenId: BigInt!, $minBought: BigInt!) {
        userPositions(
          first: 20
          where: { tokenId: $tokenId, totalBought_gt: $minBought }
          orderBy: totalBought
          orderDirection: desc
        ) {
          user
          tokenId
          amount
          avgPrice
          realizedPnl
          totalBought
        }
      }
    `;

    try {
      const data = await gql(ENDPOINTS.pnl, query, { tokenId, minBought: MIN_BOUGHT });
      for (const pos of data.userPositions) {
        const address = pos.user.toLowerCase();
        const totalBought = parseInt(pos.totalBought) / 1e6;
        const ratio = totalBought / market.volumeNum;
        if (!walletMap.has(address)) walletMap.set(address, { address, positions: [] });
        walletMap.get(address).positions.push({
          tokenId: pos.tokenId,
          market: market.question,
          category: market.category,
          marketVolume: market.volumeNum,
          totalBought,
          ratio,
          avgPrice: parseInt(pos.avgPrice) / 1e6,
          realizedPnl: parseInt(pos.realizedPnl) / 1e6,
          amount: parseInt(pos.amount) / 1e6,
        });
      }
    } catch (e) {
      console.warn(`Skipping token ${tokenId.slice(0, 8)}...: ${e.message}`);
    }

    await sleep(150);
  }

  return Array.from(walletMap.values());
}

export async function fetchWalletSplits(walletAddress) {
  const query = `
    query WalletSplits($stakeholder: String!, $count: Int!) {
      splits(
        first: $count
        where: { stakeholder: $stakeholder }
        orderBy: timestamp
        orderDirection: asc
      ) {
        id
        timestamp
        condition
        amount
      }
    }
  `;
  const data = await gql(ENDPOINTS.activity, query, {
    stakeholder: walletAddress.toLowerCase(),
    count: 500,
  });
  return data.splits.map(s => ({
    timestamp: parseInt(s.timestamp),
    condition: s.condition,
    amount: parseInt(s.amount) / 1e6,
  }));
}

export async function fetchMarketMetadataForTokens(tokenIds) {
  if (!tokenIds.length) return {};
  const metaMap = {};
  const CONCURRENCY = 5;
  for (let i = 0; i < tokenIds.length; i += CONCURRENCY) {
    const chunk = tokenIds.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async tokenId => {
      try {
        const data = await rest(`${ENDPOINTS.gamma}/markets?clob_token_ids=${tokenId}`);
        const market = Array.isArray(data) ? data[0] : data;
        if (market) {
          const title = market.question || market.title || "Unknown";
          metaMap[tokenId] = { title, category: inferCategory(title) };
        }
      } catch {
        metaMap[tokenId] = { title: "Unknown", category: "Unknown" };
      }
    }));
  }
  return metaMap;
}

export function scoreGhostWhale(walletAddress, positions, splits) {
  if (!positions.length) return { score: 0, flagged: false };
  const largestRatio  = Math.max(...positions.map(p => p.ratio));
  const largestBuy    = Math.max(...positions.map(p => p.totalBought));
  const totalSpent    = positions.reduce((s, p) => s + p.totalBought, 0);
  const positionCount = positions.length;
  const walletAgeDays = splits.length > 0
    ? (Date.now() / 1000 - splits[0].timestamp) / 86400
    : 999;
  const dominance = totalSpent > 0 ? largestBuy / totalSpent : 0;
  const score = Math.round(
    Math.min(largestRatio / 0.5, 1) * 40 +
    Math.min(largestBuy / 100_000, 1) * 25 +
    dominance * 20 +
    Math.max(0, 1 - positionCount / 5) * 15
  );
  const flagged = largestRatio >= 0.10 && largestBuy >= 10_000 && largestBuy < 500_000_000;
  return {
    score,
    flagged,
    signals: {
      largestBuyUSDC: Math.round(largestBuy),
      largestMarketOwnership: Math.round(largestRatio * 100),
      totalSpentUSDC: Math.round(totalSpent),
      positionCount,
      splitCount: splits.length,
      walletAgeDays: Math.round(walletAgeDays),
      dominanceRatio: Math.round(dominance * 100) / 100,
    },
  };
}

export function scoreSpecialist(walletAddress, positions, marketMeta) {
  if (!positions.length) return { score: 0, flagged: false };
  const totalProfit = positions.reduce((s, p) => s + p.realizedPnl, 0);
  if (totalProfit < THRESHOLDS.MIN_SPECIALIST_PROFIT_USDC) return { score: 0, flagged: false };
  const categorySpend = {};
  for (const pos of positions) {
    const cat = marketMeta[pos.tokenId]?.category || "Unknown";
    categorySpend[cat] = (categorySpend[cat] || 0) + pos.totalBought;
  }
  const totalSpent = positions.reduce((s, p) => s + p.totalBought, 0);
  const [dominantCategory, dominantSpend] = Object.entries(categorySpend)
    .sort((a, b) => b[1] - a[1])[0] || ["Unknown", 0];
  const concentration = totalSpent > 0 ? dominantSpend / totalSpent : 0;
  const score = Math.round(
    Math.min(concentration / THRESHOLDS.MIN_CATEGORY_CONCENTRATION, 1) * 50 +
    Math.max(0, 1 - positions.length / THRESHOLDS.MAX_SPECIALIST_POSITION_COUNT) * 30 +
    Math.min(totalProfit / 10_000, 1) * 20
  );
  const flagged =
    concentration >= THRESHOLDS.MIN_CATEGORY_CONCENTRATION &&
    positions.length <= THRESHOLDS.MAX_SPECIALIST_POSITION_COUNT &&
    totalProfit >= THRESHOLDS.MIN_SPECIALIST_PROFIT_USDC;
  return {
    score,
    flagged,
    signals: {
      dominantCategory,
      concentration: Math.round(concentration * 100),
      positionCount: positions.length,
      totalProfitUSDC: Math.round(totalProfit),
      categoryBreakdown: Object.fromEntries(
        Object.entries(categorySpend).map(([k, v]) => [k, Math.round(v)])
      ),
    },
  };
}

export async function runInsiderTracker() {
  const results = { ghostWhales: [], specialists: [] };

  console.log("🔍 [1/4] Fetching obscure markets ($100k–$5M volume)...");
  const markets = await fetchObscureMarkets(50);
  console.log(`   ${markets.length} markets found.`);

  console.log("🔍 [2/4] Finding large positions within those markets...");
  const largeHolders = await fetchLargePositionsInMarkets(markets);
  console.log(`   ${largeHolders.length} candidate wallets.`);

  console.log("🔍 [2b/4] Scoring Ghost Whale candidates...");
  for (const holder of largeHolders) {
    const splits = await fetchWalletSplits(holder.address);
    const scoring = scoreGhostWhale(holder.address, holder.positions, splits);
    if (scoring.flagged) {
      results.ghostWhales.push({
        address: holder.address,
        archetype: "ghost_whale",
        polymarketUrl: `https://polymarket.com/profile/${holder.address}`,
        ...scoring,
        topPositions: holder.positions.slice(0, 5),
      });
    }
  }
  results.ghostWhales.sort((a, b) => b.score - a.score);
  console.log(`   ✅ ${results.ghostWhales.length} Ghost Whales flagged.`);

  console.log("🔍 [3/4] Fetching top profitable positions...");
  const pnlData = await gql(ENDPOINTS.pnl, `
    query TopPnl($count: Int!) {
      userPositions(
        first: $count
        where: { realizedPnl_gt: "500000000" }
        orderBy: realizedPnl
        orderDirection: desc
      ) {
        user tokenId amount avgPrice realizedPnl totalBought
      }
    }
  `, { count: THRESHOLDS.PNL_LEADERBOARD_SEED_COUNT * 5 });

  const userPositionMap = new Map();
  for (const pos of pnlData.userPositions) {
    const addr = pos.user.toLowerCase();
    if (!userPositionMap.has(addr)) userPositionMap.set(addr, []);
    userPositionMap.get(addr).push({
      tokenId: pos.tokenId,
      amount: parseInt(pos.amount) / 1e6,
      avgPrice: parseInt(pos.avgPrice) / 1e6,
      realizedPnl: parseInt(pos.realizedPnl) / 1e6,
      totalBought: parseInt(pos.totalBought) / 1e6,
    });
  }

  const specialistCandidates = Array.from(userPositionMap.entries())
    .filter(([, positions]) => positions.length <= THRESHOLDS.MAX_SPECIALIST_POSITION_COUNT)
    .slice(0, THRESHOLDS.PNL_LEADERBOARD_SEED_COUNT);
  console.log(`   ${specialistCandidates.length} low-volume profitable wallets.`);

  console.log("🔍 [4/4] Scoring Specialist candidates...");
  for (const [address, positions] of specialistCandidates) {
    const tokenIds = [...new Set(positions.map(p => p.tokenId))];
    const marketMeta = await fetchMarketMetadataForTokens(tokenIds);
    const scoring = scoreSpecialist(address, positions, marketMeta);
    if (scoring.flagged) {
      results.specialists.push({
        address,
        archetype: "specialist",
        polymarketUrl: `https://polymarket.com/profile/${address}`,
        ...scoring,
        topPositions: positions.slice(0, 5).map(p => ({
          ...p,
          market: marketMeta[p.tokenId]?.title || "Unknown",
          category: marketMeta[p.tokenId]?.category || "Unknown",
        })),
      });
    }
  }
  results.specialists.sort((a, b) => b.score - a.score);
  console.log(`   ✅ ${results.specialists.length} Specialists flagged.`);

  console.log(`\n🎯 Done: ${results.ghostWhales.length} Ghost Whales, ${results.specialists.length} Specialists.`);
  return results;
}