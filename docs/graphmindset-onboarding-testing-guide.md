# GraphMindset Onboarding — Testing Guide

Complete step-by-step guide for testing the GraphMindset onboarding flow, including expected UI states, API calls, database changes, and error scenarios.

---

## Flow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  /onboarding/workspace (WelcomeStep)                                       │
│  ├─ Enter workspace name → validate slug via /api/graphmindset/slug-avail  │
│  ├─ "Build Graph" → choose payment method                                  │
│  │   ├─ "Pay with Card"      → Stripe checkout (fiat)                      │
│  │   └─ "Pay with Lightning" → /onboarding/lightning-payment               │
│  └─ After payment → claim → redirect to /onboarding/graphmindset           │
├─────────────────────────────────────────────────────────────────────────────┤
│  /onboarding/graphmindset (3-step wizard)                                  │
│  ├─ Step 1: Sphinx Link  — link Lightning wallet via QR                    │
│  ├─ Step 2: Fork Repo    — auto-fork configured repo                      │
│  └─ Step 3: Provision    — create workspace + swarm → redirect to /w/slug  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

- Local dev server running (`npm run dev`)
- Stripe test keys configured (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`)
- LND test instance (or mocked) for Lightning payments
- GitHub OAuth configured (for auth + forking)
- Swarm service accessible (or mocked)
- `SWARM_SUPER_ADMIN_URL` set (for slug validation against vanity address registry)
- `GRAPHMINDSET_FORK_REPO_URL` set (source repo for Step 2 fork)

---

## Phase 1: Payment Selection (Welcome Step)

**URL:** `/onboarding/workspace`

### Step 1.1 — Enter Workspace Name

**Action:** Type a name into the GraphMindset card's "Workspace name" input.

**What happens:**
1. 500ms debounce, then `GET /api/graphmindset/slug-availability?slug=<name>`
2. Server checks:
   - Format validation (lowercase alphanumeric + hyphens, 3-63 chars)
   - Hive DB: `SELECT * FROM workspaces WHERE slug = <name>`
   - Swarm super admin: `GET {SWARM_SUPER_ADMIN_URL}/api/super/check-domain?domain=<name>.sphinx.chat`

**Expected UI states:**
| State | What you see |
|---|---|
| Typing | Nothing (debouncing) |
| Checking | Spinner + "Checking availability…" |
| Available | Green "Name is available ✓" |
| Taken (Hive DB) | Red "This name is already taken." |
| Taken (Swarm) | Red "This vanity address is already registered." |
| Invalid format | Red format error message |

**DB at this point:** No changes.

### Step 1.2 — Click "Build Graph"

**Action:** Click the purple "Build Graph" button (enabled only when name is available).

**What happens:** Two payment buttons appear: "Pay with Card" and "Pay with Lightning".

**DB at this point:** No changes.

---

## Phase 2A: Fiat Payment (Stripe)

### Step 2A.1 — Click "Pay with Card"

**Action:** Click "Pay with Card" button.

**What happens:**
1. `localStorage.setItem("graphMindsetWorkspaceName", name)` — stored for recovery
2. `POST /api/stripe/checkout` with body:
   ```json
   { "workspaceName": "my-graph", "workspaceSlug": "my-graph" }
   ```
3. Server:
   - Generates 20-char random password
   - Encrypts password via `EncryptionService`
   - Creates Stripe checkout session ($50 USD)
   - Creates `FiatPayment` record
   - Sets `stripe_session_id` httpOnly cookie
4. Returns `{ sessionUrl, sessionId }`
5. Browser redirects to Stripe checkout

**DB after this step:**

```
FiatPayment:
  id:              cuid()
  workspaceId:     NULL           ← no workspace yet
  workspaceName:   "my-graph"
  workspaceSlug:   "my-graph"
  stripeSessionId: "cs_test_..."
  status:          PENDING        ← waiting for Stripe
  amount:          NULL           ← set by webhook
  currency:        NULL
  password:        "{encrypted}"  ← JSON with data/iv/tag/keyId
  userId:          NULL           ← not claimed yet
```

### Step 2A.2 — Complete Stripe Checkout

**Action:** On Stripe checkout page, enter test card `4242 4242 4242 4242`, any future expiry, any CVC.

**What happens:**
1. Stripe processes payment
2. Stripe sends `checkout.session.completed` webhook to `/api/stripe/webhook`
3. Server updates `FiatPayment`:
   ```sql
   UPDATE fiat_payments SET status = 'PAID' WHERE stripe_session_id = 'cs_test_...'
   ```
4. Stripe redirects browser to success URL:
   `/onboarding/workspace?payment=success&session_id=cs_test_...`

**DB after webhook:**

```
FiatPayment:
  status:                PAID     ← updated by webhook
  stripePaymentIntentId: "pi_..." ← set by webhook
  userId:                NULL     ← still not claimed
  workspaceId:           NULL     ← still no workspace
```

### Step 2A.3 — Claim Payment (Back on Welcome Step)

**Action:** Browser lands on `/onboarding/workspace?payment=success&session_id=cs_test_...`

**What happens:**
1. WelcomeStep detects `?payment=success`
2. If not authenticated → redirect to `/auth/signin?redirect=/onboarding/workspace?payment=success&session_id=...`
3. After sign-in, calls `POST /api/stripe/claim` with `{ sessionId: "cs_test_..." }`
4. Server:
   - Verifies Stripe session is paid
   - Updates `FiatPayment.userId = currentUser.id`, `status = PAID`
   - Returns `{ payment, workspaceType: "graph_mindset", redirect: "/onboarding/graphmindset?paymentType=fiat" }`
5. WelcomeStep reads `workspaceType !== "hive"` → redirects to `/onboarding/graphmindset?paymentType=fiat`

**DB after claim:**

```
FiatPayment:
  status:      PAID
  userId:      "user_abc123"    ← NOW linked to user
  workspaceId: NULL              ← still no workspace
```

**Expected UI:** Shows "Linking your payment..." spinner, then redirects.

---

## Phase 2B: Lightning Payment

### Step 2B.1 — Click "Pay with Lightning"

**Action:** Click "Pay with Lightning" button.

**What happens:**
1. `localStorage.setItem("graphMindsetWorkspaceName", name)`
2. `localStorage.setItem("graphMindsetWorkspaceSlug", name)`
3. Navigate to `/onboarding/lightning-payment`

**DB at this point:** No changes yet.

### Step 2B.2 — Invoice Generation

**Action:** Lightning payment page loads automatically.

**What happens:**
1. Reads `graphMindsetWorkspaceName` and `graphMindsetWorkspaceSlug` from localStorage
2. If missing → redirect to `/onboarding/workspace`
3. `POST /api/lightning/invoice/preauth` with body:
   ```json
   { "workspaceName": "my-graph", "workspaceSlug": "my-graph" }
   ```
4. Server:
   - Calls LND to create invoice (amount from `LIGHTNING_PAYMENT_AMOUNT_SATS` env)
   - Creates `LightningPayment` record
   - Generates QR code as data URL
   - Returns `{ invoice, paymentHash, amount, qrCodeDataUrl }`
5. UI shows QR code + copyable invoice string
6. Starts polling `GET /api/lightning/invoice/status?paymentHash=<hash>` every 3s

**DB after this step:**

```
LightningPayment:
  id:          cuid()
  workspaceId: NULL
  workspaceName: "my-graph"
  workspaceSlug: "my-graph"
  paymentHash: "abc123..."      ← unique hash
  invoice:     "lnbc..."        ← BOLT11 invoice
  amount:      50000            ← in satoshis (example)
  status:      UNPAID           ← waiting for payment
  userId:      NULL             ← not claimed
```

**Expected UI states:**
| State | What you see |
|---|---|
| Loading | Spinner + "Generating invoice…" |
| Ready | QR code + invoice string + Copy button + "Waiting for payment…" spinner |

### Step 2B.3 — Pay Invoice

**Action:** Scan QR code with a Lightning wallet and pay.

**What happens:**
1. LND settles the invoice
2. LND webhook hits `/api/lightning/webhook` with `{ payment_hash: "abc123..." }`
3. Server:
   - Fetches BTC price via `fetchBtcPriceUsd()`
   - Transactionally:
     - Updates `LightningPayment.status = PAID`
     - Creates `WorkspaceTransaction` record
4. Client polling detects `status === "PAID"`
5. Stores `localStorage.setItem("graphMindsetLightningPaymentHash", hash)`
6. Redirects to `/auth/signin?redirect=/onboarding/lightning-payment?payment=success`

**DB after payment:**

```
LightningPayment:
  status: PAID                  ← updated by webhook
  userId: NULL                  ← not claimed yet

WorkspaceTransaction:
  id:                 cuid()
  workspaceId:        NULL
  type:               LIGHTNING
  amountSats:         50000
  btcPriceUsd:        65000.00   ← market rate at time of payment
  amountUsd:          32.50      ← calculated
  lightningPaymentId: <payment_id>
```

**Fallback:** If webhook is missed, the polling endpoint (`/api/lightning/invoice/status`) checks LND directly and creates the `WorkspaceTransaction` inline.

### Step 2B.4 — Claim Lightning Payment

**Action:** After sign-in, browser returns to `/onboarding/lightning-payment?payment=success`

**What happens:**
1. Component detects `?payment=success` + authenticated session
2. Reads `graphMindsetLightningPaymentHash` from localStorage
3. `POST /api/lightning/claim` with `{ paymentHash: "abc123..." }`
4. Server links payment: `LightningPayment.userId = currentUser.id`
5. Returns `{ success: true, redirect: "/onboarding/graphmindset?paymentType=lightning" }`
6. Redirects to GraphMindset wizard

**DB after claim:**

```
LightningPayment:
  status: PAID
  userId: "user_abc123"         ← NOW linked to user
```

**Expected UI:** "Payment confirmed!" with green checkmark, then spinner while redirecting.

---

## Phase 3: GraphMindset Wizard (3 Steps)

**URL:** `/onboarding/graphmindset?paymentType=fiat` or `?paymentType=lightning`

**Auth guard:** If not authenticated → redirect to `/auth/signin?redirect=/onboarding/graphmindset`

### Step 3.1 — Sphinx Link

**Purpose:** Link user's Sphinx (Lightning) wallet for receiving payments.

**Auto-skip:** If `session.user.lightningPubkey` already exists → immediately advance to Step 2.

**What happens if not linked:**
1. Auto-generates challenge: `POST /api/auth/sphinx/challenge`
2. Returns `{ challenge, qrCode, deepLink }`
3. Shows QR code + "Open in Sphinx app" link
4. Polls `GET /api/auth/sphinx/poll/<challenge>` every 2s
5. 5-minute expiration timer

**User action:** Scan QR with Sphinx app.

**After scan:**
1. Poll returns `{ verified: true, pubkey: "02abc..." }`
2. Auto-calls `POST /api/auth/sphinx/link` with `{ challenge }`
3. Server stores pubkey on user: `user.lightningPubkey = "02abc..."`
4. Session refreshed via `update()`
5. Auto-advances to Step 2

**DB after this step:**

```
User:
  lightningPubkey: "02abc..."   ← Sphinx pubkey stored
```

**Expected UI states:**
| State | What you see |
|---|---|
| Loading | Spinner + "Generating QR code..." |
| QR ready | QR image + deep link + "Waiting for Sphinx app..." spinner |
| Verified | Briefly shows linking spinner |
| Success | Green check + "Sphinx account linked" |
| Expired | Red error + "Challenge expired. Please try again." + retry button |
| Error | Red error message + retry button |

### Step 3.2 — Fork Repository

**Purpose:** Auto-fork a preconfigured template repository into user's GitHub account.

**What happens:**
1. `GET /api/github/fork/config` → returns `{ repoUrl: "https://github.com/org/template-repo" }`
2. `POST /api/github/fork` with `{ repositoryUrl: repoUrl }`
3. Server forks repo using GitHub API (or returns existing fork URL)
4. Returns `{ forkUrl: "https://github.com/username/template-repo" }`
5. Stores `forkUrl` in component state
6. Auto-advances to Step 3

**DB after this step:** No Hive DB changes. GitHub repo is forked.

**Expected UI states:**
| State | What you see |
|---|---|
| Forking | Blue GitFork icon + "Setting up your repository" + spinner |
| Success | Green check + "Repository ready" + clickable fork URL |
| Error (scope) | "Your GitHub token doesn't have permission to fork repositories." + retry |
| Error (general) | Error message + retry button |

**Edge case:** If `GRAPHMINDSET_FORK_REPO_URL` is not set, shows "No repository configured for forking. Please contact support."

### Step 3.3 — Provision Workspace

**Purpose:** Create workspace, link payment, create swarm with GraphMindset config.

**What happens (3 sequential API calls):**

#### 3.3a — Fetch payment details

```
GET /api/graphmindset/payment
```

Server finds the user's most recent PAID payment with no workspace linked:
- If `paymentType=fiat`: queries `FiatPayment WHERE userId=X AND status=PAID AND workspaceId=NULL`
- If `paymentType=lightning`: queries `LightningPayment WHERE userId=X AND status=PAID AND workspaceId=NULL`
- Default (no type): tries fiat first, falls back to lightning

Returns:
```json
{ "payment": { "id": "clx...", "workspaceName": "my-graph", "workspaceSlug": "my-graph", "status": "PAID" } }
```

#### 3.3b — Create workspace

```
POST /api/workspaces
{
  "name": "my-graph",
  "slug": "my-graph",
  "workspaceKind": "graph_mindset"
}
```

Server:
1. Creates workspace with `workspaceKind: "graph_mindset"`
2. Finds user's PAID payment (fiat or lightning) with `workspaceId: null`
3. Transactionally:
   - Links: `FiatPayment.workspaceId = workspace.id`
   - Sets: `workspace.paymentStatus = PAID`
4. Creates `WorkspaceMember` with role `OWNER`

**DB after workspace creation:**

```
Workspace:
  id:            "clx_ws_123"
  name:          "my-graph"
  slug:          "my-graph"
  ownerId:       "user_abc123"
  workspaceKind: "graph_mindset"
  paymentStatus: PAID              ← linked from payment
  deleted:       false

FiatPayment (or LightningPayment):
  workspaceId:   "clx_ws_123"      ← NOW linked to workspace

WorkspaceMember:
  workspaceId:   "clx_ws_123"
  userId:        "user_abc123"
  role:          OWNER
```

#### 3.3c — Create swarm

```
POST /api/swarm
{
  "workspaceId": "clx_ws_123",
  "repositoryUrl": "https://github.com/username/template-repo",
  "vanity_address": "my-graph.sphinx.chat",
  "workspace_type": "graph_mindset"
}
```

Server:
1. Validates user has admin access to workspace
2. Links `SourceControlOrg` if not already linked (extracts GitHub org from fork URL)
3. Creates placeholder records transactionally:
   - `Swarm` with `status: PENDING`
   - `Repository` with `status: PENDING`
4. Generates random password for swarm
5. **GraphMindset-specific:** Calls `stakworkService().createCustomer(workspaceId)` to get:
   - `customerId`, `token`, `workflow_id`
6. Builds env vars:
   ```
   STAKWORK_ADD_NODE_TOKEN=<token>
   STAKWORK_RADAR_REQUEST_TOKEN=<token>
   OWNER_PUBKEY=<user.lightningPubkey>   (if set in Step 3.1)
   STAKWORK_CUSTOMER_ID=<customerId>
   GRAPHMINDSET_STAKWORK_WORKFLOW_ID=<workflowId>
   ```
7. Calls external `SwarmService.createSwarm()` with password, vanity_address, env vars
8. Updates placeholder with response: `swarmId`, `swarmUrl`, `ec2Id`, `swarmApiKey`
9. Sets `Swarm.status = ACTIVE`

**DB after swarm creation:**

```
Swarm:
  id:              cuid()
  workspaceId:     "clx_ws_123"    ← one-to-one with workspace
  swarmId:         "ext_swarm_789" ← external ID
  swarmUrl:        "https://my-graph.sphinx.chat"
  status:          ACTIVE
  swarmApiKey:     "{encrypted}"
  swarmPassword:   "{encrypted}"
  swarmSecretAlias: "alias_..."
  ec2Id:           "i-0abc..."
  poolState:       NOT_STARTED
  podState:        NOT_STARTED

Repository:
  id:                   cuid()
  swarmId:              <swarm.id>
  url:                  "https://github.com/username/template-repo"
  status:               PENDING
  codeIngestionEnabled: true
  docsEnabled:          true

SourceControlOrg:
  workspaceId: "clx_ws_123"
  orgName:     "username"       ← extracted from fork URL
```

#### 3.3d — Redirect

After successful swarm creation → `router.push("/w/my-graph")`

**Expected UI states:**
| State | What you see |
|---|---|
| Provisioning | Green Network icon + "Setting up your workspace" + "Provisioning your workspace and knowledge graph..." + spinner |
| Error (no payment) | "No payment found. Please complete payment first." + retry |
| Error (workspace) | "Failed to create workspace" + retry |
| Error (swarm) | "Failed to create swarm" + retry |
| Success | Redirect to `/w/my-graph` (no visible success state) |

---

## Complete DB State After Full Flow

After a successful GraphMindset onboarding (fiat example), the database should contain:

```
┌──────────────────────────────────────────────────────────────────┐
│ User                                                             │
│   lightningPubkey: "02abc..."  (set in Step 3.1)                │
├──────────────────────────────────────────────────────────────────┤
│ FiatPayment                                                      │
│   status:          PAID                                          │
│   userId:          "user_abc123"                                 │
│   workspaceId:     "clx_ws_123"                                 │
│   workspaceName:   "my-graph"                                    │
│   workspaceSlug:   "my-graph"                                    │
│   stripeSessionId: "cs_test_..."                                │
│   password:        "{encrypted}"                                 │
├──────────────────────────────────────────────────────────────────┤
│ Workspace                                                        │
│   id:              "clx_ws_123"                                  │
│   slug:            "my-graph"                                    │
│   workspaceKind:   "graph_mindset"                               │
│   paymentStatus:   PAID                                          │
│   ownerId:         "user_abc123"                                 │
├──────────────────────────────────────────────────────────────────┤
│ WorkspaceMember                                                  │
│   userId:          "user_abc123"                                 │
│   role:            OWNER                                         │
├──────────────────────────────────────────────────────────────────┤
│ Swarm                                                            │
│   workspaceId:     "clx_ws_123"                                 │
│   status:          ACTIVE                                        │
│   swarmUrl:        "https://my-graph.sphinx.chat"               │
│   poolState:       NOT_STARTED                                   │
│   podState:        NOT_STARTED                                   │
├──────────────────────────────────────────────────────────────────┤
│ Repository                                                       │
│   url:             "https://github.com/username/template-repo"  │
│   status:          PENDING                                       │
│   codeIngestion:   true                                          │
├──────────────────────────────────────────────────────────────────┤
│ SourceControlOrg                                                 │
│   orgName:         "username"                                    │
│   workspaceId:     "clx_ws_123"                                 │
├──────────────────────────────────────────────────────────────────┤
│ WorkspaceTransaction (if Lightning)                              │
│   type:            LIGHTNING                                     │
│   amountSats:      50000                                         │
│   btcPriceUsd:     65000.00                                     │
│   amountUsd:       32.50                                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## Error Scenarios & Edge Cases

### Payment Errors

| Scenario | What happens | DB state |
|---|---|---|
| Stripe checkout abandoned | Session expires after 24h | `FiatPayment.status = EXPIRED` (via webhook) |
| Stripe card declined | Stripe shows error on checkout page | `FiatPayment.status = FAILED` (via webhook) |
| Stripe checkout cancelled | Redirected to `?payment=cancelled` | `FiatPayment.status` stays `PENDING`, yellow banner shown |
| Lightning invoice expires | LND marks expired | `LightningPayment.status` stays `UNPAID` (no webhook for expiry) |
| Lightning webhook missed | Polling endpoint checks LND directly as fallback | Updates DB inline when polled |
| Double-claim (fiat) | Server checks if already PAID+userId match | Returns existing payment (idempotent) |
| Double-claim (lightning) | Server checks if userId already set | Returns success (idempotent) |

### Wizard Errors

| Scenario | What happens | Recovery |
|---|---|---|
| Sphinx QR expired (5min) | Shows "Challenge expired" error | Click "Try Again" → new challenge |
| Sphinx link API fails | Shows error message | Click "Try Again" |
| Fork repo: no config | "No repository configured" | Contact support |
| Fork repo: insufficient scope | "GitHub token doesn't have permission" | Re-authenticate with broader scope |
| Fork repo: API error | Generic error message | Click "Try Again" |
| No payment found in Step 3.3 | "No payment found. Please complete payment first." | Go back to `/onboarding/workspace` and pay again |
| Workspace slug conflict | `ensureUniqueSlug()` appends suffix | Transparent — user gets `my-graph-1` |
| Swarm service down | "Failed to create swarm" | Click "Try Again" |
| Stakwork customer creation fails | Swarm creation fails, error shown | Click "Try Again" |

### Session / Auth Edge Cases

| Scenario | What happens |
|---|---|
| Not authenticated on wizard page | Redirect to `/auth/signin?redirect=/onboarding/graphmindset` |
| Session expires mid-wizard | Next API call fails → error shown → retry after re-auth |
| Different user claims payment | Payment already has `userId` set → 403 error |
| User has no GitHub token | Fork step fails with scope error |

---

## How to Verify in Prisma Studio

Run `npx prisma studio` and check each model:

1. **FiatPayment** (or **LightningPayment**):
   - `status` = `PAID`
   - `userId` = your user ID
   - `workspaceId` = the created workspace ID
   - `workspaceName`/`workspaceSlug` match what you entered

2. **Workspace**:
   - `workspaceKind` = `"graph_mindset"`
   - `paymentStatus` = `PAID`
   - `ownerId` = your user ID

3. **Swarm**:
   - `workspaceId` matches workspace
   - `status` = `ACTIVE`
   - `swarmUrl` = `<slug>.sphinx.chat`

4. **Repository**:
   - Linked to swarm
   - `url` = your fork URL
   - `codeIngestionEnabled` = `true`

5. **User**:
   - `lightningPubkey` is set (if Sphinx step completed)

6. **WorkspaceMember**:
   - `role` = `OWNER`

---

## Testing Checklist

### Happy Path — Fiat
- [ ] Enter workspace name → see availability check
- [ ] Click "Build Graph" → see payment options
- [ ] Click "Pay with Card" → redirect to Stripe
- [ ] Complete Stripe test payment → redirect back
- [ ] Payment claimed → redirect to graphmindset wizard
- [ ] Sphinx link step → scan QR or auto-skip
- [ ] Fork step → auto-completes
- [ ] Provision step → workspace + swarm created
- [ ] Land on `/w/<slug>` workspace page
- [ ] Verify all DB records correct

### Happy Path — Lightning
- [ ] Enter workspace name → see availability check
- [ ] Click "Pay with Lightning" → navigate to lightning page
- [ ] See QR code + invoice string
- [ ] Pay invoice → polling detects PAID
- [ ] Redirect to sign-in → back to lightning page with `?payment=success`
- [ ] Payment claimed → redirect to graphmindset wizard
- [ ] Complete wizard steps → land on workspace

### Error Recovery
- [ ] Cancel Stripe checkout → see yellow banner, can retry
- [ ] Sphinx QR expires → see error, retry works
- [ ] Fork fails → see error, retry works
- [ ] Swarm creation fails → see error, retry works
- [ ] Navigate directly to `/onboarding/graphmindset` without payment → error shown

### Idempotency
- [ ] Refresh during claim step → same result (no duplicate payments)
- [ ] Refresh during provision → workspace not duplicated
- [ ] Complete flow twice with same user → second payment creates second workspace

### Auth Edge Cases
- [ ] Start as unauthenticated → prompted to sign in at right moments
- [ ] Sign out mid-wizard → redirected to sign in on next action
