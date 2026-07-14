'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getCurrencyNews } = require('../server/currency-news');

test('rejects unsupported currencies before calling GNews', async () => {
  let fetchCalled = false;
  const result = await getCurrencyNews({
    method: 'GET',
    query: { type: 'forex', symbol: 'XYZ' },
    apiKey: 'test-key',
    fetchImpl: async () => {
      fetchCalled = true;
    },
  });

  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'invalid_currency');
  assert.equal(fetchCalled, false);
});

test('requires a server-side news API key', async () => {
  const result = await getCurrencyNews({
    method: 'GET',
    query: { type: 'forex', symbol: 'EUR' },
  });

  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, 'news_not_configured');
});

test('normalizes and deduplicates GNews articles', async () => {
  let requestedUrl;
  const now = new Date('2026-07-13T20:00:00.000Z');
  const result = await getCurrencyNews({
    method: 'GET',
    query: { type: 'crypto', symbol: 'btc' },
    apiKey: 'test-key',
    now,
    fetchImpl: async url => {
      requestedUrl = new URL(url);
      return {
        ok: true,
        json: async () => ({
          articles: [
            {
              id: 'one',
              title: ' Bitcoin market update ',
              description: ' A useful description. ',
              url: 'https://news.example/article',
              publishedAt: '2026-07-13T10:00:00Z',
              source: { name: 'Example News' },
            },
            {
              id: 'duplicate',
              title: 'Bitcoin market update',
              description: 'Duplicate story.',
              url: 'https://news.example/duplicate',
              publishedAt: '2026-07-13T10:01:00Z',
              source: { name: 'Another Source' },
            },
            {
              id: 'unsafe',
              title: 'Unsafe URL',
              url: 'javascript:alert(1)',
              publishedAt: '2026-07-13T10:02:00Z',
              source: { name: 'Unsafe Source' },
            },
          ],
        }),
      };
    },
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.currency, { symbol: 'BTC', name: 'Bitcoin', type: 'crypto' });
  assert.equal(result.body.articles.length, 1);
  assert.equal(result.body.articles[0].title, 'Bitcoin market update');
  assert.equal(requestedUrl.searchParams.get('lang'), 'en');
  assert.equal(requestedUrl.searchParams.get('from'), '2026-07-10T20:00:00.000Z');
  assert.equal(requestedUrl.searchParams.get('apikey'), 'test-key');
});

test('returns a stable error when GNews is unavailable', async () => {
  const result = await getCurrencyNews({
    method: 'GET',
    query: { type: 'forex', symbol: 'EUR' },
    apiKey: 'test-key',
    fetchImpl: async () => ({ ok: false, status: 429 }),
  });

  assert.equal(result.status, 502);
  assert.equal(result.body.error.code, 'news_provider_error');
});

test('prefers a stronger source when similar headlines describe the same story', async () => {
  const now = new Date('2026-07-13T20:00:00.000Z');
  const result = await getCurrencyNews({
    method: 'GET',
    query: { type: 'crypto', symbol: 'BTC' },
    apiKey: 'test-key',
    now,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        articles: [
          {
            id: 'aggregator',
            title: 'Bitcoin ETF demand lifts crypto outlook',
            description: 'Bitcoin ETF demand increased.',
            url: 'https://aggregator.example/bitcoin-story',
            publishedAt: '2026-07-13T19:30:00Z',
            source: { name: 'Unknown Aggregator' },
          },
          {
            id: 'reuters',
            title: 'Bitcoin ETF demand lifts cryptocurrency outlook',
            description: 'Bitcoin ETF demand increased.',
            url: 'https://reuters.com/bitcoin-story',
            publishedAt: '2026-07-13T18:00:00Z',
            source: { name: 'Reuters' },
          },
          {
            id: 'old',
            title: 'Bitcoin market report from last week',
            description: 'Old Bitcoin reporting.',
            url: 'https://news.example/old',
            publishedAt: '2026-07-09T18:00:00Z',
            source: { name: 'Example News' },
          },
        ],
      }),
    }),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.articles.length, 1);
  assert.equal(result.body.articles[0].id, 'reuters');
});

test('returns no more than five ranked recent articles', async () => {
  const now = new Date('2026-07-13T20:00:00.000Z');
  const headlines = [
    'Bitcoin adoption expands among institutions',
    'Bitcoin mining output changes after adjustment',
    'Bitcoin regulation proposal reaches lawmakers',
    'Bitcoin wallet activity increases this quarter',
    'Bitcoin exchange reserves reach a new level',
    'Bitcoin payment rollout begins with retailers',
    'Bitcoin developer update changes transaction policy',
  ];
  const articles = headlines.map((title, index) => ({
    id: `article-${index}`,
    title,
    description: `Bitcoin market reporting item ${index}.`,
    url: `https://news${index}.example/story`,
    publishedAt: `2026-07-13T${String(10 + index).padStart(2, '0')}:00:00Z`,
    source: { name: `Source ${index}` },
  }));

  const result = await getCurrencyNews({
    method: 'GET',
    query: { type: 'crypto', symbol: 'BTC' },
    apiKey: 'test-key',
    now,
    fetchImpl: async () => ({ ok: true, json: async () => ({ articles }) }),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.articles.length, 5);
});

test('uses strict OpenAI structured output and preserves supporting article IDs', async () => {
  const now = new Date('2026-07-13T20:00:00.000Z');
  let openAIRequest;
  const providerArticles = [
    {
      id: 'btc-etf',
      title: 'Bitcoin ETF demand returns to the market',
      description: 'Bitcoin ETF flows increased during the latest session.',
      url: 'https://news.example/bitcoin-etf',
      publishedAt: '2026-07-13T18:00:00Z',
      source: { name: 'Reuters' },
    },
    {
      id: 'btc-policy',
      title: 'Bitcoin regulation remains in focus',
      description: 'Bitcoin traders assessed a new regulatory proposal.',
      url: 'https://policy.example/bitcoin',
      publishedAt: '2026-07-13T17:00:00Z',
      source: { name: 'Policy News' },
    },
  ];

  const result = await getCurrencyNews({
    method: 'GET',
    query: { type: 'crypto', symbol: 'BTC' },
    apiKey: 'test-news-key',
    openAIKey: 'test-openai-key',
    now,
    fetchImpl: async (url, options) => {
      if (String(url).startsWith('https://gnews.io/')) {
        return { ok: true, json: async () => ({ articles: providerArticles }) };
      }

      openAIRequest = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          output: [{
            content: [{
              type: 'output_text',
              text: JSON.stringify({
                marketSummary: 'Bitcoin may be influenced by ETF demand and regulatory expectations.',
                evidenceSufficient: true,
                factors: [
                  { label: 'ETF demand', articleIds: ['btc-etf'] },
                  { label: 'Regulatory expectations', articleIds: ['btc-policy'] },
                ],
                articleSummaries: [
                  { articleId: 'btc-etf', summary: 'Reported ETF flows increased.' },
                  { articleId: 'btc-policy', summary: 'Traders assessed a regulatory proposal.' },
                ],
              }),
            }],
          }],
        }),
      };
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.summarizationStatus, 'success');
  assert.equal(result.body.evidenceSufficient, true);
  assert.deepEqual(result.body.factors[0].articleIds, ['btc-etf']);
  assert.equal(result.body.articles[0].summary, 'Reported ETF flows increased.');
  assert.equal(openAIRequest.model, 'gpt-5.4-mini');
  assert.equal(openAIRequest.store, false);
  assert.equal(openAIRequest.text.format.type, 'json_schema');
  assert.equal(openAIRequest.text.format.strict, true);
  assert.deepEqual(
    openAIRequest.text.format.schema.properties.factors.items.properties.articleIds.items.enum.sort(),
    ['btc-etf', 'btc-policy'],
  );
});

test('rejects unsupported AI evidence IDs and reports insufficient evidence', async () => {
  const now = new Date('2026-07-13T20:00:00.000Z');
  const result = await getCurrencyNews({
    method: 'GET',
    query: { type: 'forex', symbol: 'EUR' },
    apiKey: 'test-news-key',
    openAIKey: 'test-openai-key',
    now,
    fetchImpl: async url => {
      if (String(url).startsWith('https://gnews.io/')) {
        return {
          ok: true,
          json: async () => ({
            articles: [
              {
                id: 'eur-one',
                title: 'Euro reacts to ECB policy expectations',
                description: 'The euro moved as ECB policy expectations changed.',
                url: 'https://news.example/euro',
                publishedAt: '2026-07-13T18:00:00Z',
                source: { name: 'Reuters' },
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            marketSummary: 'A summary with unsupported evidence.',
            evidenceSufficient: true,
            factors: [
              { label: 'Invented factor', articleIds: ['invented-id'] },
              { label: 'ECB expectations', articleIds: ['eur-one'] },
            ],
            articleSummaries: [
              { articleId: 'invented-id', summary: 'Invented summary.' },
              { articleId: 'eur-one', summary: 'ECB expectations changed.' },
            ],
          }),
        }),
      };
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.evidenceSufficient, false);
  assert.equal(result.body.summarizationStatus, 'insufficient_evidence');
  assert.deepEqual(result.body.factors, []);
  assert.equal(result.body.articles[0].summary, 'ECB expectations changed.');
});
