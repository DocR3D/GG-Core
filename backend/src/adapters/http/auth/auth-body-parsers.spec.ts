import express from 'express';
import type { AddressInfo } from 'net';
import { installAuthBodyParsers } from './auth-body-parsers';

describe('auth body parsers', () => {
  it('parses a real JSON POST on /auth/local', async () => {
    const app = express();
    installAuthBodyParsers(app);
    app.post('/auth/local', (req, res) => res.status(200).json({ ok: true, password: (req.body as { password?: string }).password }));
    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const response = await fetch(`http://127.0.0.1:${port}/auth/local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ password: 'secret' }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, password: 'secret' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
