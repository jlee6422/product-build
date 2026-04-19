'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const ctaBtn = document.getElementById('cta-btn');
  ctaBtn?.addEventListener('click', () => {
    alert('Hello! Ready to build something great?');
  });

  initRates();
});

// ===== Exchange Rates & Crypto =====

const FOREX_SYMBOLS = ['EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF'];

const FOREX_NAMES = {
  EUR: 'Euro', GBP: 'British Pound', JPY: 'Japanese Yen',
  CAD: 'Canadian Dollar', AUD: 'Australian Dollar', CHF: 'Swiss Franc',
};

const CRYPTO_IDS = ['bitcoin', 'ethereum', 'binancecoin', 'ripple', 'solana'];

const CRYPTO_META = {
  bitcoin:     { symbol: 'BTC', name: 'Bitcoin' },
  ethereum:    { symbol: 'ETH', name: 'Ethereum' },
  binancecoin: { symbol: 'BNB', name: 'BNB' },
  ripple:      { symbol: 'XRP', name: 'XRP' },
  solana:      { symbol: 'SOL', name: 'Solana' },
};

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
    const [forexRes, cryptoRes] = await Promise.all([
      fetch('https://open.er-api.com/v6/latest/USD'),
      fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${CRYPTO_IDS.join(',')}&vs_currencies=usd`),
    ]);

    if (!forexRes.ok || !cryptoRes.ok) throw new Error('Network error');

    const forexData = await forexRes.json();
    const cryptoData = await cryptoRes.json();

    if (forexData.result !== 'success') throw new Error('Forex API error');

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
      <div class="rate-card">
        <span class="rate-symbol">${sym}</span>
        <span class="rate-name">${FOREX_NAMES[sym]}</span>
        <span class="rate-value">${value.toFixed(4)}</span>
      </div>`;
  }).join('');
}

function renderCrypto(data) {
  const grid = document.getElementById('crypto-grid');
  grid.innerHTML = CRYPTO_IDS.map(id => {
    const meta = CRYPTO_META[id];
    const price = data[id]?.usd;
    if (!price) return '';
    const formatted = price >= 1
      ? price.toLocaleString('en-US', { maximumFractionDigits: 2 })
      : price.toFixed(6);
    return `
      <div class="rate-card">
        <span class="rate-symbol">${meta.symbol}</span>
        <span class="rate-name">${meta.name}</span>
        <span class="rate-value">$${formatted}</span>
      </div>`;
  }).join('');
}
