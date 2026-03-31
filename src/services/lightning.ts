import { optionalEnvVars } from '@/config/env';

export async function createLndInvoice(
  amount: number,
): Promise<{ payment_hash: string; payment_request: string }> {
  const baseUrl = optionalEnvVars.LIGHTNING_NODE_URL;
  const macaroon = process.env.LIGHTNING_MACAROON ?? '';
  const res = await fetch(`${baseUrl}/v1/invoices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Grpc-Metadata-Macaroon': macaroon,
    },
    body: JSON.stringify({ value: amount }),
  });
  if (!res.ok) throw new Error(`LND invoice creation failed: ${res.status}`);
  return res.json();
}
