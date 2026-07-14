import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { defineConfig, loadEnv } from 'vite';

const require = createRequire(import.meta.url);

export default defineConfig(({ mode }) => {
  // Load all env vars (including non-VITE_ ones) from .env files for the dev API.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          currency: resolve(__dirname, 'currency.html'),
        },
      },
    },
    plugins: [currencyNewsApiPlugin(env)],
  };
});

// Serves /api/currency-news during `vite dev`, mirroring the Vercel function
// in api/currency-news.js so the currency page works without `vercel dev`.
function currencyNewsApiPlugin(env) {
  return {
    name: 'currency-news-api',
    configureServer(server) {
      server.middlewares.use('/api/currency-news', async (req, res) => {
        try {
          const { getCurrencyNews } = require('./server/currency-news.js');
          const url = new URL(req.originalUrl || req.url, 'http://localhost');

          const result = await getCurrencyNews({
            method: req.method,
            query: Object.fromEntries(url.searchParams),
            apiKey: env.NEWS_API_KEY,
            openAIKey: env.OPENAI_API_KEY,
            openAIModel: env.OPENAI_MODEL || undefined,
          });

          for (const [name, value] of Object.entries(result.headers || {})) {
            res.setHeader(name, value);
          }
          res.statusCode = result.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result.body));
        } catch (error) {
          console.error('Dev currency-news middleware failed:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: { code: 'dev_middleware_error', message: 'Internal error.' } }));
        }
      });
    },
  };
}
