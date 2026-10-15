# Pool config agent API

Read and update a workspace's pool config (pm2.config.js, Dockerfile, docker-compose.yml, devcontainer.json, env vars, CPU, memory), then poll until recreated pods are ready.

## Auth

Send an org API key in the `x-api-token` header: `x-api-token: hiveorg_…`. The workspace must belong to the key's org (otherwise `403`); a revoked/invalid key gets `401`. No session is needed. (The global `API_TOKEN` also works.) The `pool/…` routes under Diagnose answer `404` for a wrong-org key instead, so a key cannot tell a foreign workspace from a missing one.

## Calls

### `GET /api/workspaces/{slug}/stakgraph`

Returns the current config in `data`:

- `poolCpu`, `poolMemory`, `services`, `repositories`
- `containerFiles`: **base64** content, keys `pm2.config.js`, `Dockerfile`, `docker-compose.yml`, `devcontainer.json`
- `environmentVariables` (`[{name, value}]`) and each `services[].env`: values are **masked** for key callers (e.g. `ab******yz`; values of 4 chars or fewer become `****`)
- `rollout`: see below

### `PUT /api/workspaces/{slug}/stakgraph`

Partial update — send only what changes:

```json
{
  "poolCpu": "4",
  "poolMemory": "16Gi",
  "environmentVariables": [{ "name": "API_KEY", "value": "ab******yz" }, { "name": "NEW", "value": "plain" }],
  "services": [{ "name": "web", "port": 3000, "scripts": { "start": "npm start" }, "env": { "TOKEN": "to****en" } }],
  "containerFiles": { "Dockerfile": "<base64>" }
}
```

It saves, pushes the config to the pool manager, and responds once the push has been accepted or has failed, so a `GET` right after returns the regenerated `pm2.config.js`. Response adds:
`changeId` (null if nothing infra-related changed), `requestedAt`, `infraChanged`, `rollout: { state: "rolling" | "failed" | "idle", error }`. On `failed`, `error` holds the reason; retry the PUT (safe: the push always sends Hive's full stored state).

**Env vars REPLACE the global list**: read with GET, edit, write the whole list back. Entries whose value is exactly the masked value you read are kept as stored; any other value replaces it; names you omit are removed.

**`services` REPLACES the list the same way**: read with GET, edit, write the whole list back; a service you omit is removed. Within a service, omit `env` to keep its stored env vars as they are; send `env` to replace them (masked values kept as stored, names you omit removed, matched by service name + var name); send `env: {}` to clear them.

## Polling

Poll `GET` every 5–10 s and read `data.rollout`:

```
{ state, changeId, requestedAt, pushedAt, error,
  pods: { new, old, oldInUse, pending, failed, minimumVms } }
```

- Make sure `rollout.changeId` equals the `changeId` from your PUT (a newer PUT supersedes it).
- `pushing` — a PUT for this change is still in flight (you only see this for someone else's PUT, since yours returns after the push).
- `rolling` — pushed; pods are being recreated (`pods.new` counts pods created after the push).
- `ready` — at least one new RUNNING, unused pod exists. Stop polling.
- `failed` — `error` holds the reason (`push_timeout` if a push never reported back within 5 min). **Retry the PUT** (safe: the push always sends Hive's full stored state).
- `idle` — no change ever recorded.

## Testing the new pods

When `ready`, `POST /api/pool-manager/claim-pod/{slug}?generation=new` with the same `hiveorg_` key to claim a pod and test. `generation=new` hands out only a pod created after the last completed push (and not flagged for recreation) — the same rule as `generation` in `pool/pods` — so the pod runs the config you just pushed. When none is ready yet the answer is `409` (try again shortly), never an older pod; it is also `409` while no push has completed. Every claim's response carries the pod's `generation` (`"new"` or `"old"`). Without the parameter the claim takes any ready pod, as before.

## Diagnose

All read-only, same auth as above (`x-api-token: hiveorg_…`, same org). A wrong-org key gets `404`, a bad/revoked key `401`. Pod passwords are never returned; log output is redacted: the pod password and every stored env var value of 6+ chars become `[redacted]`, except values under a name that is public by construction (`NEXT_PUBLIC_*`, `PUBLIC_*`, `VITE_*`, `REACT_APP_*`, `EXPO_PUBLIC_*`, `NUXT_PUBLIC_*`) or plain config (`NODE_ENV`, `PORT`, `HOST`, `HOSTNAME`), so `production` and a public URL stay readable.

- `GET /api/w/{slug}/pool/status` — pool counters plus, for token callers only: `rollout` (same shape as in Polling), `flaggedPods` (pods flagged for recreation), `minimumVms`, `minimumPods`.
- `GET /api/w/{slug}/pool/pods[?live=1]` — per pod: `podId`, `url`, `status` (raw enum), `usageStatus`, `usedBy` (`null` or `{kind:"task"|"job", id, title}`), `markedAt`, `createdAt`, `flaggedForRecreation`, `flaggedReason`, `flaggedAt`, `lastHealthCheck`, `generation` (`"new"` if created after the last push, else `"old"`; with no push recorded every pod is `"old"`), `willUpdateWhenReleased` (in use, and either flagged or created before a recorded push — nothing is pending without a push). DB only by default; `live=1` also fetches each RUNNING pod's process list (`jlist`, `null` if the pod is not RUNNING or is unreachable).
- `GET /api/w/{slug}/pool/{podId}/processes` — the pod's pm2 processes (`data.processes`). `409 {error:"pod_not_running", status}` if the pod isn't RUNNING; `502 {error:"pod_unreachable"}` if it can't be reached.
- `GET /api/w/{slug}/pool/{podId}/logs[?process=<name>&lines=<n>]` — pm2 logs, all processes or one (`process` matches `^[A-Za-z0-9._-]{1,100}$`, else 400). `lines` defaults to 200, clamped to 1..1000. Output is capped to the last 200 KB (`truncated: true`). Response `data: { podId, process, lines, logs, truncated }`. Pods in use are readable. `409 {error:"pod_not_running", status}` if the pod isn't RUNNING; `502 {error:"pod_unreachable"}` if unreachable/timeout/non-OK.

## Repair loop

1. `GET pool/status` — look at `rollout`, `flaggedPods`, failed/pending counts.
2. `GET pool/pods` — find FAILED/flagged/crashing pods.
3. `GET pool/{podId}/processes` and `GET pool/{podId}/logs[?process=…]` — find the cause.
4. `GET /api/workspaces/{slug}/stakgraph` — read the current config.
5. `PUT /api/workspaces/{slug}/stakgraph` — send the fix; keep the returned `changeId`.
6. Poll `GET …/stakgraph` (or `pool/status`) until `rollout.state` is `ready` or `failed` for that `changeId`.
7. `POST /api/pool-manager/claim-pod/{slug}?generation=new` to verify on a new pod (check `processes`/`logs` on it too).
8. `POST /api/pool-manager/drop-pod/{slug}?podId=<podId>` to release the pod you claimed when done.

Notes:
- After a push the pool manager recreates **unused** pods; pods that are **in use** are marked to update when they are released. An old pod that is in use (`willUpdateWhenReleased: true`) is therefore not a failure — don't wait for it.
- Recreation only follows a PUT that changes infrastructure. If `changeId` is `null`, nothing infra-related changed and no pods will be recreated.

## Caveat: pm2.config.js

pm2 is regenerated from `services`. A hand-written `pm2.config.js` sent **alone** is parsed into services and then regenerated from them, so formatting/extra fields may not survive. Prefer sending `services`.
