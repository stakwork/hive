# Vercel Log Drain Settings — Two-Section Redesign

## Goal

Split the Vercel Integration card into two distinct log drain configurations:

1. **Agent Analysis** — sends logs to the swarm for AI-powered analysis
2. **Realtime Monitor** — sends logs to Hive's webhook endpoint (existing behavior)

Keep the UI compact and scannable; avoid a wall of text.

---

## UX Approach

Use **two collapsible sections** inside the existing card. Each section has a short title, a one-line description, and a chevron toggle. Only one is expanded at a time (accordion style). This way the user sees both options at a glance without being overwhelmed.

```
┌─ Vercel Integration ─────────────────────────────┐
│ Connect Vercel log drains for monitoring.         │
│                                                   │
│ ▸ Log Drain — Agent Analysis                      │
│   AI-powered log analysis via your swarm.         │
│                                                   │
│ ▾ Log Drain — Realtime Monitor                    │
│   Stream logs to the Hive dashboard.              │
│   ┌──────────────────────────────────────────┐    │
│   │  (existing webhook secret + URL fields)  │    │
│   │  Setup instructions (updated to NDJSON)  │    │
│   └──────────────────────────────────────────┘    │
└───────────────────────────────────────────────────┘
```

### Agent Analysis (expanded)

Shows:
- **Endpoint URL** (read-only, copy button): e.g. `https://swarm38.sphinx.chat:9000/logs`
  - Derived from swarm name returned by the existing vercel-integration GET route.
- **Bearer Token** (read-only, copy button, show/hide toggle): the sha256-hex-24 of the swarm API key, computed server-side.
- **Compact setup steps** (numbered):
  1. Go to Vercel → Project Settings → Log Drains
  2. Set the Endpoint URL above
  3. Select **NDJSON** as Encoding
  4. Add Custom Header: `Authorization: Bearer <displayed token>`
- If no swarm is configured, show an inline "No swarm configured" notice instead.

### Realtime Monitor (expanded)

Shows the existing fields (webhook secret input, webhook URL copy) with the instructions updated to say **NDJSON** encoding instead of JSON.

---

## Backend

### Extend existing route: `GET /api/workspaces/[slug]/settings/vercel-integration`

Add two new optional fields to the response — no new route needed. The existing
route already validates the session, checks admin access, and looks up the
workspace. We just add a swarm lookup + token derivation in the same handler.

**Additional logic (after the existing workspace query):**

1. Look up the swarm for the workspace:
   ```ts
   const swarm = await db.swarm.findUnique({
     where: { workspaceId: workspace.id },
     select: { name: true, status: true, swarmApiKey: true },
   });
   ```
2. If swarm exists and is ACTIVE with a name and API key:
   - Decrypt the API key.
   - Compute `logDrainUrl` as `https://${swarm.name}.sphinx.chat:9000/logs`.
   - Compute `bearerToken`:
     ```ts
     import { createHash } from "crypto";
     const token = createHash("sha256")
       .update(decryptedApiKey)
       .digest("hex")
       .slice(0, 24);
     ```
3. Otherwise set both to `null`.

**Updated response shape:**
```ts
{
  // existing fields
  vercelWebhookSecret: string | null;
  webhookUrl: string;
  // new fields
  swarmLogDrainUrl: string | null;
  swarmBearerToken: string | null;
}
```

One request, one response, no extra round-trip.

---

## Frontend Changes

### `VercelIntegrationSettings.tsx`

1. Extend the `VercelIntegrationData` interface with the two new nullable fields.
2. Replace the single card body with two `Collapsible` sections (accordion, one open at a time).
3. **Agent Analysis section** reads `swarmLogDrainUrl` / `swarmBearerToken` from the same fetch.
   If both are `null`, show "No swarm configured" inline.
4. **Realtime Monitor section** keeps the existing webhook secret + URL fields.
5. Update the Realtime Monitor instructions to say **NDJSON** instead of JSON.

---

## File Inventory

| File | Action |
|------|--------|
| `src/app/api/workspaces/[slug]/settings/vercel-integration/route.ts` | **Edit** — add swarm lookup + token derivation to GET handler |
| `src/components/settings/VercelIntegrationSettings.tsx` | **Edit** — split into two collapsible sections |
| `src/config/middleware.ts` | None needed |

---

## Out of Scope

- Vercel API token / team ID fields (already removed from the UI, kept in DB schema).
- Automated log drain creation via Vercel API (manual setup for now).
