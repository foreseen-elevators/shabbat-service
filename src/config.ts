export const config = {
  port: Number(process.env.PORT ?? 3000),
  rateLimit: {
    windowMs: 60_000,
    max: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 20),
  },
  // Coolify / most reverse proxies sit in front of this service, so req.ip
  // must be read from X-Forwarded-For rather than the proxy's own socket
  // address, or every user would share one rate-limit bucket.
  trustProxy: process.env.TRUST_PROXY ?? '1',
};
