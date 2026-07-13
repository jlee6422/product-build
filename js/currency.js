import { CURRENCY_META } from './currency-meta.js';
import {
  CRYPTO_ID_BY_SYMBOL,
  fetchCryptoPrices,
  fetchForexRates,
} from './rates-api.js';

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

  const mockResponse = createMockResponse(CURRENCY_META[symbol]);
  renderMarketContent(mockResponse);
}

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

function createMockResponse(metadata) {
  const isCrypto = metadata.type === 'crypto';
  const policyTopic = isCrypto ? 'network developments' : 'central-bank policy';
  const activityTopic = isCrypto ? 'digital-asset activity' : 'new economic data';

  return {
    marketSummary: `${metadata.name} may be responding to ${policyTopic}, ${activityTopic}, and changes in broader market sentiment. These are sample influences for the page prototype.`,
    factors: isCrypto
      ? [
          `${metadata.name} network and ecosystem developments`,
          'Changes in cryptocurrency market sentiment',
          'Shifts in regulation and US-dollar demand',
        ]
      : [
          `${metadata.searchTerms[2]} interest-rate expectations`,
          `${metadata.name}-related inflation and economic reports`,
          'Changes in US-dollar demand and global risk sentiment',
        ],
    articles: [
      {
        title: `${metadata.name} markets focus on the latest ${policyTopic}`,
        summary: `Market participants are assessing how recent ${policyTopic} could affect demand for ${metadata.name}. This is temporary sample content.`,
        source: 'Example News',
        url: 'https://example.com/',
        publishedAt: '2026-07-13T10:00:00Z',
      },
      {
        title: `${activityTopic[0].toUpperCase()}${activityTopic.slice(1)} draws investor attention`,
        summary: `New developments have prompted investors to revisit their expectations for ${metadata.name} and related markets. This is temporary sample content.`,
        source: 'Market Daily',
        url: 'https://example.com/',
        publishedAt: '2026-07-13T07:30:00Z',
      },
      {
        title: `US-dollar demand shapes the outlook for ${metadata.name}`,
        summary: `Broader shifts in dollar demand and risk appetite may be contributing to recent price movements. This is temporary sample content.`,
        source: 'Finance Wire',
        url: 'https://example.com/',
        publishedAt: '2026-07-12T21:15:00Z',
      },
    ],
  };
}

function renderMarketContent(data) {
  renderInfluences(data);
  renderArticles(data.articles);
}

function renderInfluences(data) {
  if (!data.marketSummary || !data.factors?.length) {
    setSectionState('influences', 'empty');
    return;
  }

  document.getElementById('influences-summary').textContent = data.marketSummary;

  const factors = data.factors.map(factor => {
    const item = document.createElement('li');
    item.textContent = factor;
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
  newsCount.textContent = `${articles.length} sample articles`;
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
  summary.textContent = article.summary;

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
    ? ['loading', 'empty', 'error', 'content']
    : ['loading', 'empty', 'error', 'list'];

  states.forEach(state => {
    document
      .getElementById(`${section}-${state}`)
      ?.classList.toggle('hidden', state !== activeState);
  });
}
