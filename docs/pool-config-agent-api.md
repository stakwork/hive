# Pool config agent API

Read and update a workspace's pool config (pm2.config.js, Dockerfile, docker-compose.yml, devcontainer.json, env vars, CPU, memory), then poll until recreated pods are ready.

## Auth

Send an org API key in the `x-api-token` header: `x-api-token: hiveorg_…`. The workspace must belong to the key's org (otherwise `403`); a revoked/invalid key gets `401`. No session is needed. (The global `API_TOKEN` also works.)

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

It saves, then returns at once; the push to the pool manager happens in the background. Response adds:
`changeId` (null if nothing infra-related changed), `requestedAt`, `infraChanged`, `rollout: { state: "pushing" | "idle" }`.

**Env vars REPLACE the global list**: read with GET, edit, write the whole list back. Entries whose value is exactly the masked value you read are kept as stored; any other value replaces it; names you omit are removed. The same applies to `services[].env` (matched by service name + var name).

## Polling

Poll `GET` every 5–10 s and read `data.rollout`:

```
{ state, changeId, requestedAt, pushedAt, error,
  pods: { new, old, oldInUse, pending, failed, minimumVms } }
```

- Make sure `rollout.changeId` equals the `changeId` from your PUT (a newer PUT supersedes it).
- `pushing` — saved, being sent to the pool manager.
- `rolling` — pushed; pods are being recreated (`pods.new` counts pods created after the push).
- `ready` — at least one new RUNNING, unused pod exists. Stop polling.
- `failed` — `error` holds the reason (`push_timeout` if no result after 5 min). **Retry the PUT** (safe: the push always sends Hive's full stored state).
- `idle` — no change ever recorded.

## Testing the new pods

When `ready`, `POST /api/pool-manager/claim-pod/{slug}` with the same `hiveorg_` key to claim a pod and test.

## Caveat: pm2.config.js

pm2 is regenerated from `services`. A hand-written `pm2.config.js` sent **alone** is parsed into services and then regenerated from them, so formatting/extra fields may not survive. Prefer sending `services`.
