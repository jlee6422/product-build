'use strict';

const CURRENCY_CONFIG = require('../js/currency-meta.json');

const GNEWS_SEARCH_URL = 'https://gnews.io/api/v4/search';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';
const NEWS_WINDOW_HOURS = 72;
const GNEWS_MAX_RESULTS = 10;
const MAX_ARTICLES = 5;

const SOURCE_PREFERENCE = new Map([
  ['reuters', 40],
  ['associated press', 38],
  ['ap news', 38],
  ['bloomberg', 36],
  ['financial times', 35],
  ['the wall street journal', 35],
  ['bbc', 32],
  ['cnbc', 30],
  ['cnn', 28],
  ['the japan times', 28],
  ['euronews', 26],
]);

const HEADLINE_STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'is', 'of', 'on',
  'or', 'the', 'to', 'with', 'after', 'amid', 'latest', 'market', 'markets',
]);

async function getCurrencyNews({
  method,
  query,
  apiKey,
  openAIKey,
  openAIModel = DEFAULT_OPENAI_MODEL,
  fetchImpl = fetch,
  now = new Date(),
}) {
  if (method !== 'GET') {
    return errorResponse(405, 'method_not_allowed', 'Only GET requests are supported.', {
      Allow: 'GET',
    });
  }

  const type = firstQueryValue(query.type);
  const symbol = firstQueryValue(query.symbol)?.toUpperCase();
  const metadata = CURRENCY_CONFIG[symbol];

  if (!['forex', 'crypto'].includes(type) || !metadata || metadata.type !== type) {
    return errorResponse(400, 'invalid_currency', 'Choose a supported currency type and symbol.');
  }

  if (!apiKey) {
    return errorResponse(503, 'news_not_configured', 'The news service is not configured.');
  }

  const providerResult = await fetchGNews({ metadata, apiKey, fetchImpl, now });
  if (providerResult.error) return providerResult.error;

  const selectedArticles = selectArticles(providerResult.articles, metadata, now);
  const currency = { symbol, name: metadata.name, type: metadata.type };
  const summary = await summarizeArticles({
    currency,
    articles: selectedArticles,
    openAIKey,
    openAIModel,
    fetchImpl,
  });

  const summariesById = new Map(
    summary.articleSummaries.map(item => [item.articleId, item.summary]),
  );
  const articles = selectedArticles.map(article => ({
    ...article,
    summary: summariesById.get(article.id) || article.description,
  }));

  return {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
    body: {
      currency,
      marketSummary: summary.marketSummary,
      factors: summary.factors,
      evidenceSufficient: summary.evidenceSufficient,
      summarizationStatus: summary.status,
      articles,
      generatedAt: now.toISOString(),
    },
  };
}

async function fetchGNews({ metadata, apiKey, fetchImpl, now }) {
  const requestUrl = buildGNewsUrl(metadata, apiKey, now);
  let response;

  try {
    response = await fetchImpl(requestUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error('GNews request failed:', safeErrorMessage(error));
    return {
      error: errorResponse(502, 'news_provider_unavailable', 'News is temporarily unavailable.'),
    };
  }

  if (!response.ok) {
    console.error(`GNews returned status ${response.status}`);
    return {
      error: errorResponse(502, 'news_provider_error', 'News is temporarily unavailable.'),
    };
  }

  try {
    const data = await response.json();
    return { articles: Array.isArray(data.articles) ? data.articles : [] };
  } catch {
    return {
      error: errorResponse(502, 'invalid_provider_response', 'News is temporarily unavailable.'),
    };
  }
}

function buildGNewsUrl(metadata, apiKey, now) {
  const from = new Date(now.getTime() - NEWS_WINDOW_HOURS * 60 * 60 * 1000);
  const searchQuery = metadata.searchTerms.map(quoteSearchTerm).join(' OR ');
  const params = new URLSearchParams({
    q: `(${searchQuery})`,
    lang: 'en',
    in: 'title,description',
    sortby: 'publishedAt',
    from: from.toISOString(),
    max: String(GNEWS_MAX_RESULTS),
    apikey: apiKey,
  });

  return `${GNEWS_SEARCH_URL}?${params}`;
}

function selectArticles(providerArticles, metadata, now) {
  const cutoff = now.getTime() - NEWS_WINDOW_HOURS * 60 * 60 * 1000;
  const futureLimit = now.getTime() + 60 * 60 * 1000;

  const candidates = (Array.isArray(providerArticles) ? providerArticles : [])
    .map(normalizeArticle)
    .filter(Boolean)
    .filter(article => {
      const published = new Date(article.publishedAt).getTime();
      return published >= cutoff && published <= futureLimit;
    })
    .map(article => ({
      ...article,
      relevanceScore: scoreRelevance(article, metadata),
      sourceScore: scoreSource(article.source),
      recencyScore: scoreRecency(article.publishedAt, now),
    }))
    .filter(article => article.relevanceScore > 0)
    .sort((a, b) => totalScore(b) - totalScore(a));

  const selected = [];
  const seenUrls = new Set();

  for (const candidate of candidates) {
    if (seenUrls.has(candidate.url)) continue;
    if (selected.some(article => areSimilarHeadlines(article.title, candidate.title))) continue;

    seenUrls.add(candidate.url);
    selected.push(candidate);
    if (selected.length === MAX_ARTICLES) break;
  }

  const usedIds = new Set();
  return selected.map((article, index) => {
    let id = article.id || `article-${index + 1}`;
    if (usedIds.has(id)) id = `article-${index + 1}`;
    usedIds.add(id);

    return {
      id,
      title: article.title,
      description: article.description,
      source: article.source,
      url: article.url,
      publishedAt: article.publishedAt,
    };
  });
}

function normalizeArticle(article) {
  const url = safeHttpUrl(article?.url);
  const title = cleanText(article?.title);
  const publishedAt = validIsoDate(article?.publishedAt);

  if (!url || !title || !publishedAt) return null;

  return {
    id: cleanText(article.id) || null,
    title,
    description: cleanText(article.description) || null,
    source: cleanText(article.source?.name) || 'Unknown source',
    url,
    publishedAt,
  };
}

function scoreRelevance(article, metadata) {
  const title = article.title.toLowerCase();
  const description = (article.description || '').toLowerCase();
  let score = 0;

  metadata.searchTerms.forEach((term, index) => {
    const normalizedTerm = term.toLowerCase();
    const directTerm = index < 2;
    if (title.includes(normalizedTerm)) score += directTerm ? 6 : 3;
    if (description.includes(normalizedTerm)) score += directTerm ? 2 : 1;
  });

  return score;
}

function scoreSource(source) {
  const normalized = source.toLowerCase().trim();
  for (const [preferredSource, score] of SOURCE_PREFERENCE) {
    if (normalized.includes(preferredSource)) return score;
  }
  return 10;
}

function scoreRecency(publishedAt, now) {
  const ageHours = Math.max(0, now.getTime() - new Date(publishedAt).getTime()) / 3_600_000;
  return Math.max(0, NEWS_WINDOW_HOURS - ageHours) / NEWS_WINDOW_HOURS * 10;
}

function totalScore(article) {
  return article.relevanceScore * 10 + article.sourceScore + article.recencyScore;
}

function areSimilarHeadlines(first, second) {
  const firstTokens = headlineTokens(first);
  const secondTokens = headlineTokens(second);
  if (!firstTokens.size || !secondTokens.size) return false;

  const intersection = [...firstTokens].filter(token => secondTokens.has(token)).length;
  const union = new Set([...firstTokens, ...secondTokens]).size;
  const jaccard = intersection / union;
  const containment = intersection / Math.min(firstTokens.size, secondTokens.size);
  return jaccard >= 0.55 || containment >= 0.75;
}

function headlineTokens(headline) {
  return new Set(
    headline
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 2 && !HEADLINE_STOP_WORDS.has(token)),
  );
}

async function summarizeArticles({ currency, articles, openAIKey, openAIModel, fetchImpl }) {
  if (!articles.length) return fallbackSummary('insufficient_evidence');
  if (!openAIKey) return fallbackSummary('not_configured');

  const schema = buildSummarySchema(articles.map(article => article.id));
  const inputArticles = articles.map(({ id, title, description, source, publishedAt }) => ({
    id,
    title,
    description,
    source,
    publishedAt,
  }));

  const requestBody = {
    model: openAIModel,
    instructions: [
      'You summarize possible currency market influences using only the supplied articles.',
      'Do not use outside knowledge, browse, invent facts, or claim that an event definitely caused a price movement.',
      'Use cautious language such as may, could, or potentially.',
      'Every factor must cite one or more supplied article IDs.',
      'Produce one short, factual summary for each article that you use.',
      'If the articles do not provide enough relevant evidence, set evidenceSufficient to false and explain that briefly.',
      'Do not provide financial, investment, or trading advice.',
    ].join(' '),
    input: JSON.stringify({ currency, articles: inputArticles }),
    reasoning: { effort: 'low' },
    max_output_tokens: 1600,
    store: false,
    text: {
      format: {
        type: 'json_schema',
        name: 'currency_news_summary',
        strict: true,
        schema,
      },
    },
  };

  let response;
  try {
    response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAIKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    console.error('OpenAI request failed:', safeErrorMessage(error));
    return fallbackSummary('error');
  }

  if (!response.ok) {
    console.error(`OpenAI returned status ${response.status}`);
    return fallbackSummary('error');
  }

  try {
    const responseBody = await response.json();
    const parsed = JSON.parse(extractOutputText(responseBody));
    return validateSummary(parsed, articles);
  } catch (error) {
    console.error('OpenAI response validation failed:', safeErrorMessage(error));
    return fallbackSummary('error');
  }
}

function buildSummarySchema(articleIds) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      marketSummary: { type: 'string' },
      evidenceSufficient: { type: 'boolean' },
      factors: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            label: { type: 'string' },
            articleIds: {
              type: 'array',
              minItems: 1,
              uniqueItems: true,
              items: { type: 'string', enum: articleIds },
            },
          },
          required: ['label', 'articleIds'],
        },
      },
      articleSummaries: {
        type: 'array',
        maxItems: articleIds.length,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            articleId: { type: 'string', enum: articleIds },
            summary: { type: 'string' },
          },
          required: ['articleId', 'summary'],
        },
      },
    },
    required: ['marketSummary', 'evidenceSufficient', 'factors', 'articleSummaries'],
  };
}

function validateSummary(value, articles) {
  if (!value || typeof value !== 'object') throw new Error('Summary is not an object');

  const validIds = new Set(articles.map(article => article.id));
  const factors = (Array.isArray(value.factors) ? value.factors : [])
    .map(factor => ({
      label: cleanText(factor?.label),
      articleIds: [...new Set(
        (Array.isArray(factor?.articleIds) ? factor.articleIds : [])
          .filter(id => validIds.has(id)),
      )],
    }))
    .filter(factor => factor.label && factor.articleIds.length)
    .slice(0, 4);

  const seenSummaryIds = new Set();
  const articleSummaries = (Array.isArray(value.articleSummaries) ? value.articleSummaries : [])
    .map(item => ({
      articleId: item?.articleId,
      summary: cleanText(item?.summary),
    }))
    .filter(item => {
      if (!validIds.has(item.articleId) || !item.summary || seenSummaryIds.has(item.articleId)) return false;
      seenSummaryIds.add(item.articleId);
      return true;
    });

  const requestedSufficient = value.evidenceSufficient === true;
  const evidenceSufficient = requestedSufficient && factors.length >= 2 && articles.length >= 2;
  const marketSummary = cleanText(value.marketSummary)
    || 'There is not enough article evidence to identify potential market influences.';

  return {
    status: evidenceSufficient ? 'success' : 'insufficient_evidence',
    marketSummary,
    evidenceSufficient,
    factors: evidenceSufficient ? factors : [],
    articleSummaries,
  };
}

function fallbackSummary(status) {
  return {
    status,
    marketSummary: 'There is not enough summarized article evidence to identify potential market influences.',
    evidenceSufficient: false,
    factors: [],
    articleSummaries: [],
  };
}

function extractOutputText(responseBody) {
  if (typeof responseBody?.output_text === 'string') return responseBody.output_text;

  for (const item of responseBody?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }

  throw new Error('No output text returned');
}

function quoteSearchTerm(term) {
  return term.includes(' ') || term.includes('/') ? `"${term}"` : term;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    for (const parameter of [...url.searchParams.keys()]) {
      if (parameter.toLowerCase().startsWith('utm_')) url.searchParams.delete(parameter);
    }
    return url.href;
  } catch {
    return null;
  }
}

function validIsoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function errorResponse(status, code, message, headers = {}) {
  return { status, headers, body: { error: { code, message } } };
}

module.exports = {
  CURRENCY_CONFIG,
  areSimilarHeadlines,
  buildGNewsUrl,
  buildSummarySchema,
  getCurrencyNews,
  normalizeArticle,
  scoreRelevance,
  selectArticles,
  validateSummary,
};
