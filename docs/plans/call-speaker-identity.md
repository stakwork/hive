# Who is speaking on a call

Status: **proposed** 2026-11-02. Step 1, Hive's side, is built (the same
PR): the room index and members (`lib/calls/callRecord.ts`), the ticket
(`lib/calls/callTicket.ts`, `/api/strut-devices/calls/ticket`), the turn
and the cancel, and the GitHub token on every orchestrator turn. Voice,
Peel and meet are not, so every call still runs as its starter.

When Jamie hears a request on a call, the turn runs as the person who
STARTED the call, whoever said it. Tom starts a call from Peel, Evan asks
for a PR, and the work runs as Tom's strut actor and is billed to Tom.
This plan makes the turn run as the person who said it, when Hive knows who
that is, and as the call's starter otherwise, as today.

The call keeps ONE conversation (ruled 2026-11-02). Turns by different
speakers go into it, each run as its speaker. How that conversation shows
in Hive to everyone who spoke on the call is a later question.

## Today

- `lib/calls/startCall.ts` writes the call record (`lib/calls/callRecord.ts`,
  Redis `call:<callKey>`) with `userId` = the starter: "every turn runs as
  them". Both ways to start a call share it: the session route
  (`generate-link`, the official apps) and the device route
  (`/api/strut-devices/calls`, Peel).
- Voice (sphinx-voice `src/hive.ts`) sends `/api/calls/turn` the speaker's
  display name and nothing else. It does know each speaker's LiveKit
  identity, for speech (the participant's audio track) and for chat (the
  sender of the data message).
- `/api/calls/turn` launches `launchOrchestratorTurn({ userId: record.userId })`.
  The launch pushes that user's delegation to the strut
  (`ensureStrutDelegation` in `dispatchStrutRun`), so the turn is billed to
  them. It does not push their GitHub token. `launchJobTurn`
  (`strut-jobs.ts`) does, as the actor secret `GITHUB_TOKEN`; an
  orchestrator turn does not. So a job the turn starts on strut reads the
  actor's token only if an earlier job launch pushed it, and the swarm's
  own token otherwise. Which GitHub account opens the PR is not decided by
  the turn's user today.

## Why the name, the pubkey, or the session id is not enough

Everyone gets a LiveKit token from meet's `GET /api/connection-details`,
which checks nothing:

- the identity is `<participantName>__<4 random chars of a–z0–9>`: the
  name is what the joiner typed, and the 4 characters are about 1.7M
  possibilities, from a route anyone may ask as often as they like. LiveKit
  drops the first participant when a second joins with the same identity.
- `metadata` is passed through as the joiner sent it, and every
  participant reads it. A Sphinx pubkey there proves nothing; Peel already
  refuses to send one (`CallServer.metadata`). A signed proof there cannot
  name the identity either: meet picks it in the same request.
- `isHost=true` gives anyone room admin.

So nothing a participant gets from meet tells Hive who they are. Two other
ways were weighed and set aside:

- **Peel registers its session id with Hive** (`{ room, sid }` with the
  device credential). Every participant sees every session id, so any
  paired org member on the call could register yours as theirs, and your
  turns would run as them. Closing that needs a proof that the session is
  yours, which is the machinery below again.
- **Peel signs a bound Sphinx token over room + session id and sends it to
  Jamie**, which forwards it to Hive. Sound, but it adds a signature, a data
  message, a new voice → Hive request and a 5-minute expiry to work around.

## The design: Hive gives a paired device its ticket

A paired Peel already holds a Hive login for its person: the `hivedev_`
device credential. For a call Hive made, Peel asks Hive for its LiveKit
ticket instead of meet, and Hive picks the identity. Joining stays one
request, made to Hive instead of meet. Nobody sees a new step.

1. **Hive mints the ticket** (`POST /api/strut-devices/calls/ticket`). It
   holds the LiveKit project's key and secret already
   (`dispatchCallAgent`). The identity is `hive_` + 32 random hex
   characters and is recorded against the device's person.
2. **Voice sends the speaker's identity** on `/api/calls/turn`.
3. **The turn runs as that person.** An identity Hive did not record (meet's,
   a web joiner's, an official app's) runs as the starter, as today.

**Why no one else can hold that identity.** Hive mints it only for the
device it records it for. Meet's identities always contain `__`; Hive's
never do, so no name typed into meet can produce one. LiveKit allows one
participant per identity in a room. Anyone on the call can SEE Evan's
identity, but nobody can get a token for it.

The one assumption: no other minter on the LiveKit project hands out an
identity without `__`. Today the minters are meet and Hive. A test in meet
pins the `__` suffix (step 5).

## Hive

**State** (Redis, beside the call record). Both keys expire at the
record's last possible moment, `createdAt` + 12 h (`EXPIREAT`), not on the
record's sliding 4 h. Voice keeps refreshing the record while the call is
busy, and a sliding expiry would drop the members of a long call while the
record lives on.

- `call-room:<room>` → callKey, written by `startCall` (so by both start
  routes) and dropped with the token and the record when the dispatch
  fails. A call started before this ships has none: Peel falls back to
  meet and the call runs as today.
- `call-members:<callKey>`, a hash: identity → userId.

No table. A call's state already lives only in Redis.

**`POST /api/strut-devices/calls/ticket`** — a `webhook` route beside
`/api/strut-devices/calls` (one line in `config/middleware.ts`),
authenticated by the device credential (`validateDeviceCredential`).

```
Body: { room, participantName, metadata? }
200:  { serverUrl, roomName, participantToken, participantName }   // meet's shape
400:  bad body
401:  unknown or revoked credential
403:  the person cannot use the call's workspace
404:  no live Hive call in that room
503:  LiveKit not configured
```

- `room` → callKey (`call-room:`), then the record (`peekCallRecord`, with
  `callRecordTtl` > 0). A join does not extend the record: only voice's
  requests do, as today.
- `validateWorkspaceAccess(record.workspaceSlug, device.userId)`: read
  access, as the turn checks.
- Mints the token as meet does: TTL 5 min; grants `room`, `roomJoin`,
  `canPublish`, `canPublishData`, `canSubscribe`; never `roomAdmin`; no
  room config (Jamie is already dispatched); `name` = `participantName`,
  `metadata` passed through (at most 4 KB, JSON; Peel sends the profile
  picture's URL); identity `hive_<hex>` from `randomBytes(16)`.
- `HSET call-members:<callKey> <identity> <userId>`, then the hash's
  `EXPIREAT` (above).
- `serverUrl` is the public media URL, the one meet answers
  (`wss://livekit.sphinx.chat`). Peel refuses any other host
  (`CallServer.mediaHosts`). Hive's dispatch reads `LIVEKIT_URL`, which may
  be another address for the same project, so this needs a value of its
  own: `LIVEKIT_PUBLIC_URL`.

**`/api/calls/turn`**:

- The body takes `identity?` (a string, at most 256 characters).
- Who the turn runs as: `HGET call-members:<callKey> <identity>`. When that
  user passes `validateWorkspaceAccess`, they are the turn's user;
  otherwise it falls back to the starter, with today's 403 when the starter
  cannot use the workspace either.
- The conversation stays the call's: `persistCanvasUserMessage` keeps
  `userId: record.userId`, so the starter owns the row even when someone
  else speaks first. It is created shared (`isShared` defaults to true).
  `appendOrchestratorRows` lands a turn's reply on a shared row whoever ran
  the turn, so the other speakers' replies land.
- Everything else uses the turn's user: `launchOrchestratorTurn`, which
  takes the strut actor, delegation and GitHub token from `userId`
  (`resolveStrutTarget`), and the speaker's model pick and time zone. The
  excerpt is stored under the workspace, which the speaker can read.
  The strut session is still the conversation id, so Jamie keeps one
  thread across speakers.
- **The GitHub token goes with the turn.** `launchOrchestratorTurn` passes
  `actorSecrets: { GITHUB_TOKEN }` with the turn user's token
  (`getGithubUsernameAndPAT(userId, slug)`), as `launchJobTurn` does. Then
  a PR the turn's job opens is opened as the speaker. This applies to
  every orchestrator turn, the chat and tribes included. Without it, an
  identified speaker's turn would bill them while their PR could still be
  opened with whatever token strut already holds for them (above).
- `CallRequestSource` gains `userId?`, set when the speaker was
  identified: what a later view of the call's contributors reads.
- The call line says whose turn it is, as the tribe line does
  (`orchestratorTribeLine`'s `asker`): when the turn runs as the speaker,
  `orchestratorCallLine({ asker })` adds "<name> is a member of this org;
  this turn runs as them." to `ORCHESTRATOR_CALL_LINE`.

**`/api/calls/cancel`** ("Jamie, stop") cancels the live turn's runs by
that turn's own user. It used the starter's, which would miss a turn that
runs as another speaker.

## sphinx-voice

- `TurnRequest` gains `identity?`, the requesting participant's. The
  monitor already receives it for speech (`onTranscript`) and for chat
  (`onTextMessage`), and stores it on the transcript lines. It does not yet
  reach `processVoiceCommand` / `processTextMessage`, which take a name
  only, so it is threaded through to `sendTurn`, beside the name the
  wake-word path keeps for the asker.
- Nothing else: voice still trusts only its dispatch metadata, and Hive
  decides what an identity means.

## Peel

- Joining a call: when the device is paired and the room is one Hive made
  (`sphinx.call.-<swarm>.sphinx.chat-.<seconds>`, `docs/hive-calls.md`),
  Peel asks Hive's `calls/ticket` first, with the same name and metadata it
  sends meet. On a 403, a 404 or a failure it asks meet as today, and the
  call runs as its starter. It never asks Hive about another room, so a
  plain call in a DM never reaches Hive.
- Hive's answer is meet's shape, so `CallServer.ticket(...)`'s checks apply
  unchanged, against the account's call server as for meet's answer: the
  media host (`mediaHosts`), the room, the expiry.
- A rejoin asks again and gets a new identity.
- The starter's own Peel does the same; their turns run as them either way.

## Meet

- A test that every identity `connection-details` mints ends in
  `__<4 chars>`, with a comment saying Hive's speaker identity depends on it
  (step 5). Nothing else changes.

## Steps

Each step stands alone; until the next lands, the call runs as its starter.

1. **Hive (built):** the room index in `startCall`, the members hash, the
   ticket route, the middleware line, `/api/calls/turn` reading `identity`,
   the cancel by the live turn's user, and the GitHub token pushed with
   every orchestrator turn. `LIVEKIT_PUBLIC_URL` must be set where it is
   deployed (`wss://livekit.sphinx.chat`, meet's `LIVEKIT_URL`); unset, the
   route answers 503 and devices join through meet.
2. **sphinx-voice:** `identity` on the turn.
3. **Peel:** ask Hive for the ticket on a Hive room.
4. **Live check:** Tom starts a call from Peel, Evan joins from Peel and
   asks Jamie for a PR. The StrutRun's `userId` is Evan's, the strut run's
   actor is Evan's, and the PR is opened as Evan's GitHub account. A web
   joiner's request runs as Tom.
5. **Meet:** the identity-shape test.

## Tests

- Ticket route: 401 / 400 / 404 (no index, expired record) / 403 (no
  workspace access) / 200; the identity matches `/^hive_[0-9a-f]{32}$/` and
  never contains `__`; the hash holds it with the record's expiry; no
  `roomAdmin` in the grant.
- `startCall` writes `call-room:` for both routes, and a failed dispatch
  drops it with the rest; both keys expire at `createdAt` + 12 h.
- `launchOrchestratorTurn` pushes the turn user's `GITHUB_TOKEN`, and
  pushes nothing when the user has no token.
- Turn: an identified speaker runs as themselves; an unknown identity, no
  identity, an identity from another call, or a speaker who lost access
  runs as the starter; the conversation is created under the starter when
  someone else speaks first; two speakers share one conversation; the call
  line says whose turn it is.
- Cancel: a turn running as another speaker is stopped by that speaker's
  runs.
- Voice: `identity` on the turn for speech and for chat.
- Peel: a Hive room asks Hive first and falls back to meet on 403 / 404 /
  failure; a plain room never asks Hive; Hive's answer passes the ticket
  checks.

## Not changed

- An unidentified speaker still runs as the starter: decision 1 of Peel's
  `docs/hive-calls.md`, which stays the simple choice for now.
- Who decides a proposal: anyone who can read the call's conversation
  (`resolveProposalTurn`), as the clicking user. The apply runs with the
  PROPOSER's credentials on strut, which is now the speaker.
- The official apps and the web keep meet's tickets; their speakers run as
  the starter.

## Open

1. **Deciding a speaker's proposal.** Tribes let only the turn's user decide
   by reply. Should a call proposal made on Evan's turn wait for Evan, or
   may Tom accept it, applied with Evan's credentials?
2. **An unshared call conversation.** If the starter unshares it, the other
   speakers' replies stop landing (`appendOrchestratorRows` bails on an
   unshared row whose owner is someone else). This belongs with the
   contributors view.
3. **The official apps.** They hold a Hive JWT from
   `/api/auth/sphinx/token`. The ticket route could take it beside the
   device credential, and the apps would ask Hive for Hive rooms the way
   Peel does.

## Found along the way

Meet's `isHost=true` gives anyone who asks room admin, which lets them
remove other participants. It is unrelated to this plan and worth a change
of its own.
