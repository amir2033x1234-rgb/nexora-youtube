import { createHash } from 'node:crypto';

const FEED = 'https://trends.google.com/trending/rss';
const CACHE_MS = 10 * 60 * 1000;
const MAX_FEED_BYTES = 1_000_000;
const clamp = n => Math.max(0, Math.min(100, Math.round(n)));

async function readLimited(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_FEED_BYTES) throw new Error('Trend feed exceeds the 1 MB safety limit.');
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_FEED_BYTES) throw new Error('Trend feed exceeds the 1 MB safety limit.');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FEED_BYTES) {
      await reader.cancel();
      throw new Error('Trend feed exceeds the 1 MB safety limit.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function decodeXml(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([\da-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name])
    .trim();
}

function tag(xml, name) {
  const match = xml.match(new RegExp(`<(?:(?:[A-Za-z_][\\w.-]*):)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[A-Za-z_][\\w.-]*):)?${name}\\s*>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function approximateSearches(label) {
  const match = String(label).replaceAll(',', '').match(/([\d.]+)\s*([KMB])?\+?/i);
  if (!match) return null;
  const multiplier = ({ K: 1_000, M: 1_000_000, B: 1_000_000_000 })[String(match[2] || '').toUpperCase()] || 1;
  const value = Number(match[1]) * multiplier;
  return Number.isFinite(value) ? value : null;
}

function stableId(regionCode, title, publishedAt) {
  const day = Number.isFinite(Date.parse(publishedAt)) ? new Date(publishedAt).toISOString().slice(0, 10) : 'undated';
  return createHash('sha256').update(`${regionCode}:${title.toLocaleLowerCase()}:${day}`).digest('hex').slice(0, 24);
}

export function parseGoogleTrendsRss(xml, { regionCode = 'US', now = Date.now(), fetchedAt = new Date(now).toISOString() } = {}) {
  if (Buffer.byteLength(String(xml)) > 1_000_000) throw new Error('Trend feed exceeds the 1 MB safety limit.');
  const blocks = [...String(xml).matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0, 100);
  const seen = new Set();
  const items = [];
  for (const [, block] of blocks) {
    const title = tag(block, 'title');
    if (!title || seen.has(title.toLocaleLowerCase())) continue;
    seen.add(title.toLocaleLowerCase());
    const publishedAt = tag(block, 'pubDate');
    const date = Date.parse(publishedAt);
    const ageHours = Number.isFinite(date) ? Math.max(0, (now - date) / 3_600_000) : null;
    const freshnessScore = ageHours == null ? null : clamp(100 * Math.exp(-ageHours / 36));
    const trafficLabel = tag(block, 'approx_traffic');
    const approximateVolume = approximateSearches(trafficLabel);
    const audienceInterestScore = approximateVolume == null ? null : clamp(20 * Math.log10(approximateVolume + 1));
    const trendScore = freshnessScore == null || audienceInterestScore == null
      ? null
      : clamp(freshnessScore * 0.65 + audienceInterestScore * 0.35);
    const relatedArticles = [...block.matchAll(/<(?:[\w.-]+:)?news_item(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w.-]+:)?news_item\s*>/gi)].slice(0, 5).map(([, article]) => ({
      title: tag(article, 'news_item_title'),
      url: tag(article, 'news_item_url'),
      publisher: tag(article, 'news_item_source'),
      snippet: tag(article, 'news_item_snippet')
    })).filter(x => x.title && /^https?:\/\//i.test(x.url));
    const explore = `https://trends.google.com/trends/explore?${new URLSearchParams({ geo: regionCode, q: title })}`;
    items.push({
      id: stableId(regionCode, title, publishedAt), title, regionCode,
      source: 'Google Trends Trending now RSS', feedUrl: `${FEED}?geo=${encodeURIComponent(regionCode)}`,
      exploreUrl: explore, publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : null,
      fetchedAt, ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10,
      trafficLabel: trafficLabel || null, approximateSearches: approximateVolume,
      trendScore, audienceInterestScore, freshnessScore,
      competitionScore: null, contentOpportunityScore: null, productionDifficulty: null,
      confidence: 'LOW', relatedArticles,
      trendScoreMethod: 'Heuristic: 65% freshness decay (36-hour e-folding constant) plus 35% log-scaled reported search volume; not calibrated against video outcomes.',
      limitations: 'Google Search trend signal only; not YouTube demand, competition, forecast, or estimated production cost.'
    });
  }
  return items;
}

export function createGoogleTrendsProvider({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  const cache = new Map();
  const inFlight = new Map();
  async function trending({ regionCode = 'US', force = false } = {}) {
    const region = String(regionCode).toUpperCase();
    if (!/^[A-Z]{2}$/.test(region)) throw new Error('regionCode must be a two-letter country or region code.');
    const cached = cache.get(region);
    if (!force && cached && now() - cached.time < CACHE_MS) return { ...cached.value, cached: true };
    if (inFlight.has(region)) return inFlight.get(region);
    const request = (async () => {
      const url = `${FEED}?geo=${encodeURIComponent(region)}`;
      const response = await fetchImpl(url, { headers: { accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Google Trends feed request failed (${response.status}).`);
      const xml = await readLimited(response);
      if (!/<rss(?:\s|>)/i.test(xml)) throw new Error('Google Trends returned an unexpected feed format.');
      const fetchedAt = new Date(now()).toISOString();
      const value = { source: 'Google Trends Trending now RSS', feedUrl: url, regionCode: region, fetchedAt, refreshIntervalMs: CACHE_MS, items: parseGoogleTrendsRss(xml, { regionCode: region, now: now(), fetchedAt }) };
      cache.set(region, { time: now(), value });
      return { ...value, cached: false };
    })().finally(() => inFlight.delete(region));
    inFlight.set(region, request);
    return request;
  }
  return { trending };
}
