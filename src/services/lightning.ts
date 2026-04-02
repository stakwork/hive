import https from 'node:https';
import { URL } from 'node:url';
import { optionalEnvVars } from '@/config/env';

export async function lookupLndInvoice(
  paymentHashHex: string,
): Promise<{ settled: boolean }> {
  const baseUrl = optionalEnvVars.LIGHTNING_NODE_URL;
  const macaroon = optionalEnvVars.LIGHTNING_MACAROON;
  const tlsCertB64 = optionalEnvVars.LIGHTNING_TLS_CERT;

  // LND REST requires the r_hash as base64url in the URL path
  const r_hash_b64url = Buffer.from(paymentHashHex, 'hex').toString('base64url');
  const url = new URL(`${baseUrl}/v1/invoice/${r_hash_b64url}`);

  const agentOptions = tlsCertB64
    ? { ca: Buffer.from(tlsCertB64, 'base64').toString('utf-8') }
    : {};

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'GET',
        headers: {
          'Grpc-Metadata-Macaroon': macaroon,
        },
        ...agentOptions,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode >= 300) {
            return reject(new Error(`LND invoice lookup failed: ${res.statusCode}`));
          }
          const parsed = JSON.parse(data);
          resolve({ settled: parsed.settled === true });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

export async function createLndInvoice(
  amount: number,
): Promise<{ payment_hash: string; payment_request: string }> {
  const baseUrl = optionalEnvVars.LIGHTNING_NODE_URL;
  const macaroon = optionalEnvVars.LIGHTNING_MACAROON;
  const tlsCertB64 = optionalEnvVars.LIGHTNING_TLS_CERT;

  const url = new URL(`${baseUrl}/v1/invoices`);
  const body = JSON.stringify({ value: amount });

  const agentOptions = tlsCertB64
    ? { ca: Buffer.from(tlsCertB64, 'base64').toString('utf-8') }
    : {};

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Grpc-Metadata-Macaroon': macaroon,
        },
        ...agentOptions,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode >= 300) {
            return reject(new Error(`LND invoice creation failed: ${res.statusCode}`));
          }
          const parsed = JSON.parse(data);
          const payment_hash = Buffer.from(parsed.r_hash, 'base64').toString('hex');
          resolve({ payment_hash, payment_request: parsed.payment_request });
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
