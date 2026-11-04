import { randomUUID } from 'node:crypto';

export const capabilities = [
  { id: 'trend-research', name: 'Trend research', status: 'PARTIAL', detail: 'Fetches and scores public Google Trends RSS search signals on request; YouTube competition, audience fit, and forecasts remain unknown without evidence.' },
  { id: 'content-intelligence', name: 'Content intelligence', status: 'IMPLEMENTED', detail: 'Stores searchable channels, topics, scripts, jobs, sources, and metrics locally.' },
  { id: 'fact-checking', name: 'Fact checking', status: 'PARTIAL', detail: 'Evidence ledger flags unsupported claims; it does not independently verify truth.' },
  { id: 'strategy-calendar', name: 'Strategy and calendar', status: 'IMPLEMENTED', detail: 'Plans channel-specific content and scheduling dates.' },
  { id: 'script-generator', name: 'Script generator', status: 'PARTIAL', detail: 'Creates structured outlines from user inputs; language model provider is not connected.' },
  { id: 'voiceover', name: 'Voiceover', status: 'PROVIDER_REQUIRED', detail: 'No text-to-speech provider is configured.' },
  { id: 'video-production', name: 'Video production', status: 'PARTIAL', detail: 'Rights-aware jobs can be queued and moved through worker-facing states; no cloud worker is configured to execute them.' },
  { id: 'subtitles', name: 'Subtitles', status: 'PARTIAL', detail: 'Converts a supplied transcript into timed SRT; speech recognition is not connected.' },
  { id: 'thumbnails', name: 'Thumbnails', status: 'PARTIAL', detail: 'Produces an editable SVG title-card template, not generated photography.' },
  { id: 'seo-metadata', name: 'SEO and metadata', status: 'PARTIAL', detail: 'Creates editable metadata suggestions from supplied facts and keywords.' },
  { id: 'youtube-oauth', name: 'YouTube OAuth', status: 'PROVIDER_REQUIRED', detail: 'OAuth credentials and callback verification are not configured.' },
  { id: 'youtube-publishing', name: 'YouTube publishing', status: 'PROVIDER_REQUIRED', detail: 'A guarded upload adapter exists; grant the separate YouTube upload scope and pass every approval, rights, and quality gate.' },
  { id: 'analytics', name: 'Analytics', status: 'PARTIAL', detail: 'Stores user-entered metrics; YouTube Analytics API is not connected.' },
  { id: 'resource-quotas', name: 'Resource quotas', status: 'IMPLEMENTED', detail: 'Enforces a configurable daily limit on production jobs.' },
  { id: 'recovery', name: 'Failure recovery', status: 'PARTIAL', detail: 'Persists worker status and allows bounded retry only after a recorded failure; no automatic worker recovery is configured.' },
  { id: 'quality', name: 'Quality scoring', status: 'IMPLEMENTED', detail: 'Scores explicit checklist inputs and blocks jobs below the quality threshold.' },
  { id: 'multi-channel', name: 'Multi-channel', status: 'IMPLEMENTED', detail: 'Channels keep separate language, audience, brand, and cadence settings.' },
  { id: 'dashboard', name: 'Dashboard', status: 'IMPLEMENTED', detail: 'Displays persisted application and workflow state.' }
];

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Number(n) || 0));
const clean = (value, max = 2000) => String(value ?? '').trim().slice(0, max);

export function scoreIdea(input) {
  const evidenceCount = Array.isArray(input.sources) ? input.sources.filter(s => s && s.url && s.title).length : 0;
  const trend = clamp(input.trendScore);
  const interest = clamp(input.audienceInterest);
  const freshness = clamp(input.freshness);
  const competition = clamp(input.competitionScore);
  const difficulty = clamp(input.productionDifficulty);
  const evidence = Math.min(100, evidenceCount * 25);
  const opportunity = Math.round((trend * .22) + (interest * .25) + (freshness * .18) + ((100 - competition) * .15) + ((100 - difficulty) * .10) + (evidence * .10));
  return { trendScore: trend, audienceInterest: interest, freshness, competitionScore: competition, productionDifficulty: difficulty, evidenceSources: evidenceCount, opportunityScore: opportunity, confidence: evidenceCount >= 3 ? 'moderate' : evidenceCount ? 'low' : 'insufficient', predictionIsNotGuarantee: true };
}

export function createScript(input) {
  const topic = clean(input.topic, 180);
  if (!topic) throw new Error('topic is required');
  const format = input.format === 'short' ? 'short' : 'long';
  const audience = clean(input.audience, 180) || 'the intended audience';
  const promise = clean(input.viewerPromise, 240) || `A clear, useful explanation of ${topic}`;
  const facts = Array.isArray(input.keyPoints) ? input.keyPoints.map(x => clean(x, 240)).filter(Boolean).slice(0, 8) : [];
  const sections = format === 'short'
    ? [{ label: 'Hook (0–3s)', prompt: `Open with a specific question or surprising, verifiable detail about ${topic}.` }, { label: 'Value (3–45s)', prompt: facts.length ? facts.join('\n') : `Explain one useful idea for ${audience}. Add evidence before making factual claims.` }, { label: 'Payoff and close', prompt: `${promise}. End with one natural next step.` }]
    : [{ label: 'Hook', prompt: `State the viewer's problem and the specific payoff: ${promise}. Avoid unsupported superlatives.` }, { label: 'Context', prompt: `Explain why ${topic} matters to ${audience}; cite sources for factual statements.` }, ...facts.map((fact, i) => ({ label: `Chapter ${i + 1}`, prompt: fact })), { label: 'Conclusion', prompt: `Summarize the useful takeaways, name any remaining uncertainty, and give one relevant next step.` }];
  return { id: randomUUID(), topic, format, audience, sections, sourceStatus: facts.length ? 'facts supplied by user; verify before production' : 'research required', generatedBy: 'deterministic outline template; no AI model called', createdAt: new Date().toISOString() };
}

export function assessClaims(claims) {
  if (!Array.isArray(claims) || !claims.length) throw new Error('claims must be a non-empty array');
  return claims.slice(0, 30).map((entry, index) => {
    const claim = clean(typeof entry === 'string' ? entry : entry.claim, 1000);
    const sources = Array.isArray(entry?.sources) ? entry.sources.filter(s => s?.url && s?.title).slice(0, 10) : [];
    const corroborating = sources.filter(s => s.position === 'supports').length;
    const contradicting = sources.filter(s => s.position === 'contradicts').length;
    const state = !claim ? 'invalid' : !sources.length ? 'unverified' : corroborating && contradicting ? 'conflicting' : corroborating ? 'supported_by_submitted_sources' : contradicting ? 'contradicted_by_submitted_sources' : 'inconclusive';
    return { index, claim, status: state, sources, note: 'Assessment reflects only the source labels supplied by the user; source contents and truth were not independently checked.' };
  });
}

export function makeSubtitles(input) {
  const lines = Array.isArray(input.lines) ? input.lines : String(input.transcript ?? '').split(/\n+/).map(text => ({ text }));
  const items = lines.map((item, i) => ({ text: clean(typeof item === 'string' ? item : item.text, 500), start: Number(item?.start), end: Number(item?.end) })).filter(item => item.text);
  if (!items.length) throw new Error('transcript or non-empty lines are required');
  let cursor = 0;
  const format = seconds => { const ms = Math.round(seconds * 1000); const h = Math.floor(ms / 3600000); const m = Math.floor((ms % 3600000) / 60000); const s = Math.floor((ms % 60000) / 1000); return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms % 1000).padStart(3,'0')}`; };
  const cues = items.map((item, i) => {
    const start = Number.isFinite(item.start) && item.start >= cursor ? item.start : cursor;
    const end = Number.isFinite(item.end) && item.end > start ? item.end : start + Math.max(1.5, Math.min(5, item.text.length / 15));
    cursor = end + .12;
    return { index: i + 1, start, end, text: item.text };
  });
  const srt = cues.map(c => `${c.index}\n${format(c.start)} --> ${format(c.end)}\n${c.text}`).join('\n\n') + '\n';
  return { format: 'srt', language: clean(input.language, 12) || 'und', cues, srt, generatedFrom: 'provided transcript; timing estimated unless timestamps were provided' };
}

export function scoreQuality(input) {
  const criteria = ['originality','storytelling','visualQuality','audioQuality','editingQuality','factualAccuracy','subtitleQuality','thumbnailQuality','audienceValue','copyrightCompliance'];
  const missing = criteria.filter(k => input[k] === undefined || input[k] === null);
  const values = Object.fromEntries(criteria.filter(k => input[k] !== undefined && input[k] !== null).map(k => [k, clamp(input[k])]));
  const score = Object.keys(values).length ? Math.round(Object.values(values).reduce((a,b)=>a+b,0) / Object.keys(values).length) : 0;
  const rightsClear = values.copyrightCompliance === 100;
  return { score, criteria: values, missing, ready: !missing.length && score >= 75 && rightsClear, threshold: 75, reasons: [...(missing.length ? [`Missing scores for: ${missing.join(', ')}`] : []), ...(score < 75 ? ['Score is below 75.'] : []), ...(!rightsClear ? ['Copyright compliance must be explicitly scored 100.'] : [])] };
}

export function validateAssetRights(assets) {
  if (!Array.isArray(assets) || !assets.length) return { ready: false, issues: ['At least one media asset with documented rights is required.'] };
  const issues = [];
  assets.forEach((asset, i) => {
    if (!asset?.url) issues.push(`Asset ${i + 1}: URL or local reference is required.`);
    if (!asset?.license) issues.push(`Asset ${i + 1}: license is not recorded.`);
    if (!asset?.proof) issues.push(`Asset ${i + 1}: license proof or source attribution is missing.`);
    if (asset?.commercialUse !== true) issues.push(`Asset ${i + 1}: commercial-use permission is not confirmed.`);
  });
  return { ready: issues.length === 0, issues };
}

export function suggestMetadata(input) {
  const topic = clean(input.topic, 180);
  if (!topic) throw new Error('topic is required');
  const points = Array.isArray(input.keyPoints) ? input.keyPoints.map(x => clean(x, 240)).filter(Boolean).slice(0, 5) : [];
  const keywords = [...new Set([topic, ...(Array.isArray(input.keywords) ? input.keywords : [])].map(x => clean(x, 80)).filter(Boolean))].slice(0, 15);
  const title = clean(input.title, 100) || `${topic}: a practical guide`;
  const description = [clean(input.summary, 500) || `A practical, evidence-aware guide to ${topic}.`, points.length ? `In this video:\n${points.map(p => `• ${p}`).join('\n')}` : '', 'Add source links and disclosures before publishing.'].filter(Boolean).join('\n\n');
  return { title, description, tags: keywords, playlistSuggestion: clean(input.series, 100) || null, generatedBy: 'rule-based metadata draft; review claims and channel fit' };
}

export function makeThumbnailSvg(input) {
  const esc = s => clean(s, 60).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const title = clean(input.title || input.topic || 'YOUR TITLE', 180);
  const words = title.split(/\s+/); const rows = []; let row = '';
  for (const word of words) { if ((row + ' ' + word).trim().length > 18 && row) { rows.push(row); row = word; } else row = (row ? row + ' ' : '') + word; }
  if (row) rows.push(row); const shown = rows.slice(0, 3);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#101827"/><stop offset="1" stop-color="#273b55"/></linearGradient></defs><rect width="1280" height="720" fill="url(#bg)"/><circle cx="1090" cy="120" r="210" fill="#61e6c2" opacity=".12"/><rect x="84" y="82" width="10" height="556" rx="5" fill="#61e6c2"/><text x="132" y="190" fill="#61e6c2" font-family="Arial,sans-serif" font-weight="700" font-size="28">NEXORA • ${esc(input.channel || 'VIDEO')}</text>${shown.map((line,i)=>`<text x="132" y="${330+i*108}" fill="#ffffff" font-family="Arial,sans-serif" font-weight="800" font-size="76">${esc(line)}</text>`).join('')}<text x="132" y="630" fill="#b8c6d9" font-family="Arial,sans-serif" font-size="26">Editable title card • replace with licensed artwork</text></svg>`;
}

export function newJob(input) {
  const rights = validateAssetRights(input.assets);
  if (!rights.ready) return { accepted: false, error: 'rights_review_required', rights };
  const quality = scoreQuality(input.quality || {});
  if (!quality.ready) return { accepted: false, error: 'quality_gate_failed', quality };
  return { accepted: true, job: { id: randomUUID(), channelId: clean(input.channelId, 100), topic: clean(input.topic, 180), status: 'queued', stage: 'queued', retryCount: 0, assets: input.assets, quality, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } };
}

export const initialChannels = [{ id: 'default', name: 'My channel', language: 'en', audience: '', category: '', cadencePerWeek: 2, brand: { primaryColor: '#61e6c2', voice: 'clear and evidence-aware' }, createdAt: new Date().toISOString() }];
