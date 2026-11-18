export const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
] as const;

export const CORS_METHODS = [
  'GET',
  'HEAD',
  'PUT',
  'PATCH',
  'POST',
  'DELETE',
  'OPTIONS',
] as const;

export const CORS_ALLOWED_HEADERS = [
  'Authorization',
  'Content-Type',
  'wallet-address',
  'accept',
] as const;

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

export function parseCorsOrigins(raw?: string): string[] {
  if (!raw) {
    return [...DEFAULT_CORS_ORIGINS];
  }
  const parsed = raw
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...DEFAULT_CORS_ORIGINS];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isCorsOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (!origin) {
    return true;
  }
  const normalized = normalizeOrigin(origin);
  for (const pattern of allowedOrigins) {
    if (pattern === '*') {
      return true;
    }
    if (pattern.includes('*')) {
      const regexBody = pattern
        .split('*')
        .map(escapeRegExp)
        .join('[^/]*');
      if (new RegExp(`^${regexBody}$`).test(normalized)) {
        return true;
      }
      continue;
    }
    if (normalized === pattern) {
      return true;
    }
  }
  return false;
}

export type CorsOriginCallback = (
  err: Error | null,
  allow?: boolean,
) => void;

export function createCorsOriginValidator(
  getAllowedOrigins: () => readonly string[],
) {
  return (origin: string | undefined, callback: CorsOriginCallback): void => {
    callback(null, isCorsOriginAllowed(origin, getAllowedOrigins()));
  };
}

export function buildCorsOptions(getAllowedOrigins: () => readonly string[]) {
  return {
    origin: createCorsOriginValidator(getAllowedOrigins),
    credentials: false,
    methods: [...CORS_METHODS],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
  };
}
