import Redis from 'ioredis';

const globalForRedis = globalThis as unknown as { redis?: Redis };

function createRedisClient(): Redis {
  // lazyConnect: defer the TCP connection until the first command. Importing a
  // module that transitively depends on redis (e.g. rate-limit) should not open
  // a socket as a side effect — in unit tests and during Next.js prerendering
  // there is no Redis to connect to, and the eager connect only produced
  // background connection attempts that nobody asked for.
  const client = new Redis(process.env.REDIS_URL!, { lazyConnect: true });

  // ioredis emits an 'error' event on every failed (re)connection attempt.
  // Without a listener it logs "[ioredis] Unhandled error event:" via
  // console.error, which is noise in production and breaks tests that assert
  // on console output. Callers still see command-level failures as rejected
  // promises — nothing is swallowed functionally.
  client.on('error', () => {});

  return client;
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}
