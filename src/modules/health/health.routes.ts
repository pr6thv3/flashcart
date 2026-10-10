import { Router, Request, Response } from 'express';
import { checkHealth } from '../../db/pool.js';

export const healthRoutes = Router();

healthRoutes.get('/', async (_req: Request, res: Response) => {
  const dbHealth = await checkHealth();
  if (dbHealth.status === 'healthy') {
    res.status(200).json({ status: 'ok', database: dbHealth, timestamp: new Date().toISOString() });
  } else {
    res.status(503).json({ status: 'degraded', database: dbHealth, timestamp: new Date().toISOString() });
  }
});

healthRoutes.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'live', timestamp: new Date().toISOString() });
});

healthRoutes.get('/ready', async (_req: Request, res: Response) => {
  const dbHealth = await checkHealth();
  if (dbHealth.status === 'healthy') {
    res.status(200).json({
      status: 'ready',
      database: dbHealth,
      timestamp: new Date().toISOString(),
    });
  } else {
    res.status(503).json({
      status: 'unready',
      database: dbHealth,
      timestamp: new Date().toISOString(),
    });
  }
});
