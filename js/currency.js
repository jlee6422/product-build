import { CURRENCY_META } from './currency-meta.js';
import {
  CRYPTO_ID_BY_SYMBOL,
  fetchCryptoPrices,
  fetchForexRates,
} from './rates-api.js';

const NEWS_TIMEOUT_MS = 12_000;
let activeNewsController;

const params = new URLSearchParams(window.location.search);
const type = params.get('type');
const symbol = params.get('symbol')?.toUpperCase();

const allowedSymbols = Object.entries(CURRENCY_META)
  .filter(([, metadata]) => metadata.type === type)
  .map(([currencySymbol]) => currencySymbol);

if (!['forex', 'crypto'].includes(type) || !allowedSymbols.includes(symbol)) {
  window.location.href = '/';
} else {
  const currencyName = CURRENCY_META[symbol].name;

  document.title = `${symbol} — ${currencyName} | Invia`;
  document.getElementById('currency-symbol').textContent = symbol;
  document.getElementById('currency-title').textContent = currencyName;
  document.getElementById('rate-label').textContent = type === 'crypto'
    ? `${symbol} price in USD`
    : `1 USD in ${symbol}`;

  loadCurrentRate();
  loadCurrencyNews();
}

document.querySelectorAll('.news-retry').forEach(button => {
  button.addEventListener('click', loadCurrencyNews);
});

async function loadCurrentRate() {
  const ratePanel = document.querySelector('.rate-panel');
  const rateValue = document.getElementById('rate-value');
  const rateUpdated = document.getElementById('rate-updated');

  try {
    if (type === 'forex') {
      const data = await fetchForexRates();
      const value = data.rates[symbol];

      if (!Number.isFinite(value)) {
        throw new Error(`No exchange rate returned for ${symbol}`);
      }

      rateValue.textContent = `${value.toFixed(4)} ${symbol}`;
      rateUpdated.textContent = formatUpdatedTime(data.time_last_update_utc);
    } else {
      const cryptoId = CRYPTO_ID_BY_SYMBOL[symbol];
      const data = await fetchCryptoPrices([cryptoId]);
      const price = data[cryptoId]?.usd;

      if (!Number.isFinite(price)) {
        throw new Error(`No price returned for ${symbol}`);
      }

      rateValue.textContent = formatUsdPrice(price);
      rateUpdated.textContent = formatUpdatedTime(new Date());
    }

    ratePanel.classList.remove('rate-panel--error');
  } catch (error) {
    console.error('Current rate fetch error:', error);
    rateValue.textContent = 'Unavailable';
    rateUpdated.textContent = 'The current rate could not be loaded. Please try again later.';
    ratePanel.classList.add('rate-panel--error');
  }
}

function formatUsdPrice(price) {
  if (price >= 1) {
    return price.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    });
  }

  return `$${price.toFixed(6)}`;
}

function formatUpdatedTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Latest available rate';
  }

  return `Updated ${date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}`;
}

async function loadCurrencyNews() {
  activeNewsController?.abort();
  const controller = new AbortController();
  activeNewsController = controller;
  let didTimeout = false;

  setNewsLoading();

  const timeoutId = window.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, NEWS_TIMEOUT_MS);

  try {
    const query = new URLSearchParams({ type, symbol });
    const response = await fetch(`/api/currency-news?${query}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Currency news request failed with status ${response.status}`);
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.articles)) {
      throw new Error('Currency news returned an invalid response');
    }

    if (activeNewsController !== controller) return;
    renderMarketContent(data);
  } catch (error) {
    if (activeNewsController !== controller) return;

    console.error('Currency news fetch error:', error);
    const message = didTimeout
      ? 'The request took too long. Check your connection and try again.'
      : 'We could not retrieve recent currency news. Please try again.';
    showNewsError(message);
  } finally {
    window.clearTimeout(timeoutId);
    if (activeNewsController === controller) activeNewsController = undefined;
  }
}

function setNewsLoading() {
  document.getElementById('news-count').classList.add('hidden');
  document.getElementById('news-list').replaceChildren();
  document.getElementById('influences-list').replaceChildren();
  setSectionState('influences', 'loading');
  setSectionState('news', 'loading');
}

function showNewsError(message) {
  document.getElementById('influences-error-message').textContent = message;
  document.getElementById('news-error-message').textContent = message;
  setSectionState('influences', 'error');
  setSectionState('news', 'error');
}

function renderMarketContent(data) {
  const articles = data.articles;

  if (!articles.length) {
    setSectionState('influences', 'empty');
    setSectionState('news', 'empty');
    return;
  }

  renderInfluences(data, articles);
  renderArticles(articles);
}

function renderInfluences(data, articles) {
  if (!data.evidenceSufficient || !data.marketSummary || !data.factors?.length) {
    const fallbackMessage = data.marketSummary
      || 'Recent articles are available, but they do not provide enough evidence for a reliable market summary.';
    document.getElementById('influences-insufficient-message').textContent = fallbackMessage;
    setSectionState('influences', 'insufficient');
    return;
  }

  document.getElementById('influences-summary').textContent = data.marketSummary;
  const articlesById = new Map(articles.map(article => [article.id, article]));

  const factors = data.factors.map(factor => {
    const item = document.createElement('li');
    item.className = 'influence-item';

    const label = document.createElement('span');
    label.className = 'influence-label';
    label.textContent = factor.label;
    item.append(label);

    const supportingArticles = (factor.articleIds || [])
      .map(articleId => articlesById.get(articleId))
      .filter(Boolean);

    if (supportingArticles.length) {
      const sources = document.createElement('div');
      sources.className = 'influence-sources';
      supportingArticles.forEach(article => {
        const link = createArticleLink(article.url, article.source);
        link.className = 'influence-source';
        sources.append(link);
      });
      item.append(sources);
    }

    return item;
  });

  document.getElementById('influences-list').replaceChildren(...factors);
  setSectionState('influences', 'content');
}

function renderArticles(articles) {
  if (!articles?.length) {
    setSectionState('news', 'empty');
    return;
  }

  const articleCards = articles.map(createArticleCard);
  document.getElementById('news-list').replaceChildren(...articleCards);

  const newsCount = document.getElementById('news-count');
  newsCount.textContent = `${articles.length} related ${articles.length === 1 ? 'article' : 'articles'}`;
  newsCount.classList.remove('hidden');
  setSectionState('news', 'list');
}

function createArticleCard(article) {
  const card = document.createElement('article');
  card.className = 'news-item';

  const meta = document.createElement('div');
  meta.className = 'news-meta';

  const source = document.createElement('span');
  source.className = 'news-source';
  source.textContent = article.source;

  const time = document.createElement('time');
  time.dateTime = article.publishedAt;
  time.textContent = formatPublishedDate(article.publishedAt);
  meta.append(source, time);

  const heading = document.createElement('h3');
  const titleLink = createArticleLink(article.url, article.title);
  heading.append(titleLink);

  const summary = document.createElement('p');
  summary.textContent = article.summary
    || article.description
    || 'Open the original article to read the full report.';

  const readLink = createArticleLink(article.url, 'Read original article →');
  readLink.className = 'read-link';

  card.append(meta, heading, summary, readLink);
  return card;
}

function createArticleLink(url, label) {
  const link = document.createElement('a');
  link.href = getSafeArticleUrl(url);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = label;
  return link;
}

function getSafeArticleUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.href : '#';
  } catch {
    return '#';
  }
}

function formatPublishedDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Recently published';
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function setSectionState(section, activeState) {
  const states = section === 'influences'
    ? ['loading', 'empty', 'insufficient', 'error', 'content']
    : ['loading', 'empty', 'error', 'list'];

  states.forEach(state => {
    document
      .getElementById(`${section}-${state}`)
      ?.classList.toggle('hidden', state !== activeState);
  });
}
