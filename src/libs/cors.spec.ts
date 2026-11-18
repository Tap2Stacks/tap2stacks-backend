import { Controller, Get, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  CORS_ALLOWED_HEADERS,
  CORS_METHODS,
  DEFAULT_CORS_ORIGINS,
  buildCorsOptions,
  isCorsOriginAllowed,
  parseCorsOrigins,
} from './cors';

@Controller('cors-test')
class CorsTestController {
  @Get()
  ping() {
    return { ok: true };
  }

  @Post()
  submit() {
    return { ok: true };
  }
}

describe('cors helper', () => {
  it('falls back to local dev defaults when CORS_ORIGINS is empty', () => {
    expect(parseCorsOrigins(undefined)).toEqual([...DEFAULT_CORS_ORIGINS]);
    expect(parseCorsOrigins('')).toEqual([...DEFAULT_CORS_ORIGINS]);
    expect(parseCorsOrigins(' ,  , ')).toEqual([...DEFAULT_CORS_ORIGINS]);
  });

  it('parses comma-separated origins and strips trailing slashes', () => {
    expect(
      parseCorsOrigins('https://st-web.vercel.app/, http://localhost:5173 '),
    ).toEqual(['https://st-web.vercel.app', 'http://localhost:5173']);
  });

  it('validates exact, wildcard, and absent origins safely', () => {
    const allowed = ['https://st-web.vercel.app', 'https://preview-*.vercel.app'];
    expect(isCorsOriginAllowed(undefined, allowed)).toBe(true);
    expect(isCorsOriginAllowed('https://st-web.vercel.app', allowed)).toBe(true);
    expect(isCorsOriginAllowed('https://st-web.vercel.app/', allowed)).toBe(true);
    expect(isCorsOriginAllowed('https://preview-abc.vercel.app', allowed)).toBe(
      true,
    );
    expect(
      isCorsOriginAllowed('https://preview-abc.vercel.app.evil.com', allowed),
    ).toBe(false);
    expect(isCorsOriginAllowed('https://evil.example.com', allowed)).toBe(false);
  });

  it('configures non-credentialed HTTP & Socket.IO CORS options', () => {
    const opts = buildCorsOptions(() => ['https://st-web.vercel.app']);
    expect(opts.credentials).toBe(false);
    expect(opts.methods).toEqual([...CORS_METHODS]);
    expect(opts.allowedHeaders).toEqual([...CORS_ALLOWED_HEADERS]);
  });

  it('allows preflight with wallet-address from allowed origin and rejects disallowed origins', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CorsTestController],
    }).compile();

    const app = moduleRef.createNestApplication();
    const allowed = parseCorsOrigins(
      'https://st-web.vercel.app,http://localhost:5173',
    );
    app.enableCors(buildCorsOptions(() => allowed));
    await app.init();

    try {
      const preflightAllowed = await request(app.getHttpServer())
        .options('/cors-test')
        .set('Origin', 'https://st-web.vercel.app')
        .set('Access-Control-Request-Method', 'POST')
        .set(
          'Access-Control-Request-Headers',
          'authorization,content-type,wallet-address,accept',
        )
        .expect(204);
      expect(preflightAllowed.headers['access-control-allow-origin']).toBe(
        'https://st-web.vercel.app',
      );
      expect(
        preflightAllowed.headers['access-control-allow-credentials'],
      ).toBeUndefined();
      expect(preflightAllowed.headers['access-control-allow-methods']).toBe(
        'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      );
      expect(preflightAllowed.headers['access-control-allow-headers']).toBe(
        'Authorization,Content-Type,wallet-address,accept',
      );

      const preflightRejected = await request(app.getHttpServer())
        .options('/cors-test')
        .set('Origin', 'https://evil.example.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'wallet-address');
      // A rejected origin is not answered by the CORS middleware (the request falls
      // through to routing, so the status is not 204); what blocks the browser is
      // the missing Access-Control-Allow-Origin header.
      expect(preflightRejected.status).not.toBe(204);
      expect(
        preflightRejected.headers['access-control-allow-origin'],
      ).toBeUndefined();

      const allowedRes = await request(app.getHttpServer())
        .get('/cors-test')
        .set('Origin', 'https://st-web.vercel.app')
        .expect(200);
      expect(allowedRes.headers['access-control-allow-origin']).toBe(
        'https://st-web.vercel.app',
      );
      expect(
        allowedRes.headers['access-control-allow-credentials'],
      ).toBeUndefined();

      const rejectedRes = await request(app.getHttpServer())
        .get('/cors-test')
        .set('Origin', 'https://evil.example.com')
        .expect(200);
      expect(rejectedRes.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
