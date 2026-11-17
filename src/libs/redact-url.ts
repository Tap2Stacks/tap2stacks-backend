const SENSITIVE_PAYMASTER_PATH_RE = /(\/api\/paymaster\/t\/)[^/?#]+/;

/** Redacts the short-lived paymaster token segment from URLs before logging. */
export function redactSensitivePath(url: string): string {
  return url.replace(SENSITIVE_PAYMASTER_PATH_RE, '$1[redacted]');
}
