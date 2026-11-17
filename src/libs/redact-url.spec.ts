import { describe, expect, it } from 'vitest';
import { redactSensitivePath } from './redact-url';

describe('redactSensitivePath', () => {
  it('redacts the path segment after /api/paymaster/t/ while preserving query strings', () => {
    expect(redactSensitivePath('/api/paymaster/t/abc.def.ghi?x=1')).toBe(
      '/api/paymaster/t/[redacted]?x=1',
    );
    expect(redactSensitivePath('/api/paymaster/t/header.payload.sig')).toBe(
      '/api/paymaster/t/[redacted]',
    );
    expect(
      redactSensitivePath('https://api.example.com/api/paymaster/t/tok123?a=2'),
    ).toBe('https://api.example.com/api/paymaster/t/[redacted]?a=2');
  });

  it('leaves other paths unchanged', () => {
    expect(redactSensitivePath('/api/paymaster/token')).toBe(
      '/api/paymaster/token',
    );
    expect(redactSensitivePath('/api/orders?limit=20')).toBe(
      '/api/orders?limit=20',
    );
    expect(redactSensitivePath('/api/health-check')).toBe('/api/health-check');
  });
});
