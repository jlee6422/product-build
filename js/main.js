import { CURRENCY_META } from './currency-meta.js';
import {
  CRYPTO_IDS,
  CRYPTO_ID_BY_SYMBOL,
  fetchCryptoPrices,
  fetchForexRates,
} from './rates-api.js';

'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const ctaBtn = document.getElementById('cta-btn');
  ctaBtn?.addEventListener('click', () => {
    alert('Hello! Ready to build something great?');
  });

  initRates();
  initChat();
});

// ===== Chat Widget =====

function initChat() {
  const toggle = document.getElementById('chat-toggle');
  const widget = document.getElementById('chat-widget');
  const form   = document.getElementById('chat-form');
  const input  = document.getElementById('chat-input');
  const messages = document.getElementById('chat-messages');

  toggle.addEventListener('click', () => {
    widget.classList.toggle('open');
    if (widget.classList.contains('open')) input.focus();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    appendMessage(text, 'sent');
    input.value = '';

    setTimeout(() => {
      appendMessage("Thanks for your message! We'll get back to you soon.", 'received');
    }, 800);
  });

  function appendMessage(text, type) {
    const div = document.createElement('div');
    div.className = `chat-msg chat-msg--${type}`;
    div.innerHTML = `<p>${escapeHtml(text)}</p>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
}

// ===== Exchange Rates & Crypto =====

const FOREX_SYMBOLS = ['EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF'];

const CRYPTO_SYMBOLS = Object.fromEntries(
  Object.entries(CRYPTO_ID_BY_SYMBOL).map(([symbol, id]) => [id, symbol]),
);

const REFRESH_INTERVAL = 30;
let secondsUntilRefresh = 0;

function initRates() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  fetchRates();

  setInterval(() => {
    secondsUntilRefresh--;
    if (secondsUntilRefresh <= 0) {
      fetchRates();
    } else {
      const updatedEl = document.getElementById('rates-updated');
      if (updatedEl.dataset.base) {
        updatedEl.textContent = `${updatedEl.dataset.base} — refreshing in ${secondsUntilRefresh}s`;
      }
    }
  }, 1000);
}

async function fetchRates() {
  const errorEl = document.getElementById('rates-error');
  const updatedEl = document.getElementById('rates-updated');
  secondsUntilRefresh = REFRESH_INTERVAL;

  try {
    const [forexData, cryptoData] = await Promise.all([
      fetchForexRates(),
      fetchCryptoPrices(),
    ]);

    renderForex(forexData.rates);
    renderCrypto(cryptoData);

    const date = new Date(forexData.time_last_update_utc);
    const baseText = `Updated: ${date.toLocaleDateString(undefined, { dateStyle: 'medium' })}`;
    updatedEl.dataset.base = baseText;
    updatedEl.textContent = `${baseText} — refreshing in ${REFRESH_INTERVAL}s`;
    errorEl.classList.add('hidden');
  } catch (err) {
    console.error('Rates fetch error:', err);
    errorEl.classList.remove('hidden');
    updatedEl.textContent = '';
    updatedEl.dataset.base = '';
    document.getElementById('forex-grid').innerHTML = '';
    document.getElementById('crypto-grid').innerHTML = '';
  }
}

function renderForex(rates) {
  const grid = document.getElementById('forex-grid');
  grid.innerHTML = FOREX_SYMBOLS.map(sym => {
    const value = rates[sym];
    if (!value) return '';
    return `
      <a class="rate-card" href="/currency.html?type=forex&symbol=${sym}">
        <span class="rate-symbol">${sym}</span>
        <span class="rate-name">${CURRENCY_META[sym].name}</span>
        <span class="rate-value">${value.toFixed(4)}</span>
      </a>`;
  }).join('');
}

function renderCrypto(data) {
  const grid = document.getElementById('crypto-grid');
  grid.innerHTML = CRYPTO_IDS.map(id => {
    const symbol = CRYPTO_SYMBOLS[id];
    const meta = CURRENCY_META[symbol];
    const price = data[id]?.usd;
    if (!price) return '';
    const formatted = price >= 1
      ? price.toLocaleString('en-US', { maximumFractionDigits: 2 })
      : price.toFixed(6);
    return `
      <a class="rate-card" href="/currency.html?type=crypto&symbol=${symbol}">
        <span class="rate-symbol">${symbol}</span>
        <span class="rate-name">${meta.name}</span>
        <span class="rate-value">$${formatted}</span>
      </a>`;
  }).join('');
}
