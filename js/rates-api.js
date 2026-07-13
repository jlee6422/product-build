export const CRYPTO_ID_BY_SYMBOL = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  XRP: 'ripple',
  SOL: 'solana',
};

export const CRYPTO_IDS = Object.values(CRYPTO_ID_BY_SYMBOL);

const FOREX_API_URL = 'https://open.er-api.com/v6/latest/USD';
const CRYPTO_API_URL = 'https://api.coingecko.com/api/v3/simple/price';

export async function fetchForexRates() {
  const response = await fetch(FOREX_API_URL);

  if (!response.ok) {
    throw new Error(`Forex request failed with status ${response.status}`);
  }

  const data = await response.json();

  if (data.result !== 'success' || !data.rates) {
    throw new Error('Forex service returned an invalid response');
  }

  return data;
}

export async function fetchCryptoPrices(ids = CRYPTO_IDS) {
  const query = new URLSearchParams({
    ids: ids.join(','),
    vs_currencies: 'usd',
  });
  const response = await fetch(`${CRYPTO_API_URL}?${query}`);

  if (!response.ok) {
    throw new Error(`Crypto request failed with status ${response.status}`);
  }

  const data = await response.json();

  if (!data || typeof data !== 'object') {
    throw new Error('Crypto service returned an invalid response');
  }

  return data;
}
