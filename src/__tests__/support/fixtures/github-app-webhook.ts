import crypto from "crypto";

/**
 * GitHub App authorization revoked event payload
 */
export function createGitHubAppAuthorizationRevokedPayload(senderLogin: string = "testuser") {
  return {
    action: "revoked",
    sender: {
      login: senderLogin,
      id: 123456,
      node_id: "MDQ6VXNlcjEyMzQ1Ng==",
      avatar_url: "https://avatars.githubusercontent.com/u/123456?v=4",
      type: "User",
    },
  };
}

/**
 * Compute HMAC-SHA256 signature for webhook payload
 */
export function computeGitHubAppWebhookSignature(secret: string, body: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  const digest = hmac.update(body).digest("hex");
  return `sha256=${digest}`;
}

/**
 * Create a webhook request with proper headers and signature
 */
export function createGitHubAppWebhookRequest(
  url: string,
  payload: object,
  signature: string,
  event: string = "github_app_authorization"
) {
  const body = JSON.stringify(payload);

  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hub-signature-256": signature,
      "x-github-event": event,
      "x-github-delivery": crypto.randomUUID(),
    },
    body,
  });
}