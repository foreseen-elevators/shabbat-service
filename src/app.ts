import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { apiRouter } from './routes/api.js';

export function createApp() {
  const app = express();

  // Required behind Coolify's reverse proxy so express-rate-limit keys off
  // the real client IP (X-Forwarded-For) instead of the proxy's address.
  app.set('trust proxy', config.trustProxy);

  app.use(helmet());
  app.use(cors());

  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down.' },
  });
  app.use(limiter);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api', apiRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
