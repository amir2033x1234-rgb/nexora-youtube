import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleTrendsProvider, parseGoogleTrendsRss } from '../src/trends.mjs';

const sample=`<?xml version="1.0"?><rss><channel><item><title>Solar &amp; wind</title><ht:approx_traffic>20K+</ht:approx_traffic><pubDate>Wed, 04 Nov 2026 08:00:00 GMT</pubDate><ht:news_item><ht:news_item_title>Energy report</ht:news_item_title><ht:news_item_url>https://news.example/report</ht:news_item_url><ht:news_item_source>Example News</ht:news_item_source><ht:news_item_snippet>New energy figures</ht:news_item_snippet></ht:news_item></item><item><title>Older topic</title><ht:approx_traffic>500+</ht:approx_traffic><pubDate>Tue, 03 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>`;

test('Google Trends RSS parser records attributed search signals without inventing YouTube metrics',()=>{
  const now=Date.parse('2026-11-04T09:00:00Z');
  const items=parseGoogleTrendsRss(sample,{regionCode:'US',now});
  assert.equal(items.length,2);assert.equal(items[0].title,'Solar & wind');assert.equal(items[0].approximateSearches,20_000);
  assert.ok(items[0].trendScore>items[1].trendScore);assert.equal(items[0].competitionScore,null);assert.equal(items[0].contentOpportunityScore,null);
  assert.equal(items[0].confidence,'LOW');assert.equal(items[0].relatedArticles[0].publisher,'Example News');assert.match(items[0].relatedArticles[0].url,/^https:\/\//);
  assert.match(items[0].limitations,/not YouTube demand/);
});

test('Google Trends provider caches by region, bounds region input and coalesces in-flight requests',async()=>{
  let now=Date.parse('2026-11-04T09:00:00Z'),calls=0;
  const provider=createGoogleTrendsProvider({now:()=>now,fetchImpl:async url=>{calls++;assert.match(String(url),/geo=US/);await new Promise(resolve=>setTimeout(resolve,10));return new Response(sample,{status:200,headers:{'content-type':'application/rss+xml'}})}});
  const [a,b]=await Promise.all([provider.trending({regionCode:'us'}),provider.trending({regionCode:'US'})]);assert.equal(calls,1);assert.equal(a.items.length,2);assert.equal(b.items.length,2);
  assert.equal((await provider.trending({regionCode:'US'})).cached,true);assert.equal(calls,1);
  now+=10*60*1000;assert.equal((await provider.trending({regionCode:'US'})).cached,false);assert.equal(calls,2);
  await assert.rejects(()=>provider.trending({regionCode:'USA'}),/two-letter/);
});

test('Google Trends provider rejects HTTP errors, HTML responses and oversized feeds',async()=>{
  const failed=createGoogleTrendsProvider({fetchImpl:async()=>new Response('upstream failed',{status:503})});
  await assert.rejects(()=>failed.trending(),/503/);
  const html=createGoogleTrendsProvider({fetchImpl:async()=>new Response('<html>blocked</html>',{status:200})});
  await assert.rejects(()=>html.trending(),/unexpected feed format/);
  const oversized=createGoogleTrendsProvider({fetchImpl:async()=>new Response('x'.repeat(1_000_001),{status:200})});
  await assert.rejects(()=>oversized.trending(),/1 MB/);
  assert.throws(()=>parseGoogleTrendsRss('x'.repeat(1_000_001)),/1 MB/);
});
