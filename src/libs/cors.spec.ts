import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CORS_ORIGINS,
  createCorsOriginValidator,
  isCorsOriginAllowed,
  parseCorsOrigins,
} from './cors';

@Controller('cors-test')
class CorsTestController {
  @Get()
  ping() {
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

  it('sets CORS headers only for allowed origins in Nest HTTP middleware', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CorsTestController],
    }).compile();

    const app = moduleRef.createNestApplication();
    const allowed = parseCorsOrigins(
      'https://st-web.vercel.app,http://localhost:5173',
    );
    app.enableCors({
      credentials: true,
      origin: createCorsOriginValidator(() => allowed),
    });
    await app.init();

    try {
      const allowedRes = await request(app.getHttpServer())
        .get('/cors-test')
        .set('Origin', 'https://st-web.vercel.app')
        .expect(200);
      expect(allowedRes.headers['access-control-allow-origin']).toBe(
        'https://st-web.vercel.app',
      );
      expect(allowedRes.headers['access-control-allow-credentials']).toBe('true');

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
