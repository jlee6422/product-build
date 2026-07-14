'use strict';

const { getCurrencyNews } = require('../server/currency-news');

module.exports = async function handler(request, response) {
  const result = await getCurrencyNews({
    method: request.method,
    query: request.query || {},
    apiKey: process.env.NEWS_API_KEY,
    openAIKey: process.env.OPENAI_API_KEY,
    openAIModel: process.env.OPENAI_MODEL,
  });

  Object.entries(result.headers).forEach(([name, value]) => {
    response.setHeader(name, value);
  });

  return response.status(result.status).json(result.body);
};
