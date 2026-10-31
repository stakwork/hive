# Jamie in Sphinx tribes

Status: **proposed** 2026-10-29. The Sphinx side is built as `wasm/daemon`
(stakwork/sphinx#401) and was tested live in a tribe the same day, in echo
mode, with no Hive behind it ("Step 0", below).

A tribe owner links their tribe to one of their orgs in Peel. From then on
anyone in the tribe can write `@jamie …`, and Jamie, the org's orchestrator,
answers in the tribe with its deliverables. That includes a job's result
hours later, after the person who asked has closed their phone: everyone in
the tribe sees it.

This is Jamie on a call (`/api/calls/turn`, `/api/calls/messages`), with a
Sphinx account in place of the voice agent and a lasting link in place of
the call record.

## What people do

- **The owner:** tribe details → **Jamie** → pick one of their paired orgs
  (Stadeum). That is the whole setup. If the device isn't paired yet, the
  picker starts Hive's pairing first. **No Jamie** unlinks.
- **Everyone else in the tribe:** types `@jamie`. Nothing to install, pair
  or link. The official Sphinx apps work too.
- **Jamie** is one Sphinx contact, the same in every tribe. Each reply names
  its org ("Jamie · Acme").

## The shape

```
Peel (owner) ── link ──► Hive
                          ▲
                          │ mentions, the outbox (every call Jamie's)
tribe ◄── member ──► Jamie (wasm/daemon)          Hive ──► org's strut: orchestrator
```

- **Jamie is an ordinary member account**, one for every tribe of every org.
  `wasm/daemon` runs it: sphinx-chat's account and code, kept connected. It
  knows nothing about orgs.
- **It's a new account, not Hive's DM bot** (`V2_BOT_URL`). An account holds
  one live connection: the broker knows a connection by the account's key
  and drops the older one when the same key connects again. So the DM bot
  stays as it is.
- **Hive keeps the links and runs the turns**, as it does for a call. A
  mention becomes a turn of the org's orchestrator, run as the person who
  linked the tribe. Jamie reads the replies from Hive and posts them.
- **No change** to the tribe server, the Sphinx core, strut or sphinx-voice.

## Decisions

1. **Hive is the brain.** Jamie has to answer while nobody's device is on,
   so whatever runs the turn must be always on and hold the org's
   credential. Hive already holds the swarm keys, the delegations, the
   conversations and the job wake (`invokeOrchestratorOnJobTurn`), and calls
   already work this way.

2. **Jamie is a member, not the tribe server's bot.** The tribe server can
   push every message to one `BOTS_SERVER` and exempt one bot pubkey from
   membership (`tribes/src/bot.rs`). We don't use that:
   - it needs tribe-server changes. `to_bot` is awaited inline before the
     message settles, with no timeout. It sends the sender's original uuid,
     which members never see. Its type-25 replies are left out of history and
     Peel doesn't show them;
   - it reaches only tribe servers whose operator points `BOTS_SERVER` at
     Hive, so no home-server tribes;
   - it would send Hive every message of every tribe on that server;
   - the bot server it would be built on, stakwork/sphinx-bots-v2 (behind
     bots.v2.sphinx.chat), had no commits from 2024-08 until a security fix
     (stakwork/sphinx-bots-v2#9).

   As a member, Jamie works on any tribe server, home ones included. The
   owner decides it is there, and can remove it like any member. Only linked
   tribes reach Hive, and threads, history and rendering are a member's.

   The bot path's one advantage is the sender's real pubkey, which point 3
   doesn't need.

3. **Turns run as the person who linked the tribe**, as a call's turns run
   as the person who started it (`calls/turn/route.ts`, "Turns run as the
   person who started the call"). Inside a tribe, nobody but the tribe
   server knows who wrote a message. It re-signs every forwarded message with
   the tribe's key and keeps only the alias
   (`tribes/src/forward.rs`, `mutate_msg_to_forward`). Jamie passes the alias
   on as the speaker.

4. **Only the owner links.** In a private tribe, Jamie's join is a member
   request, and the owner's Peel approves it without asking. That keeps setup
   to one tap, and the approval proves the linker owns the tribe. Hive can't
   check ownership otherwise: the public tribe record names the owner's
   alias, not their key.

5. **One conversation per mention**, a `SharedConversation` of the
   linker's, and so one orchestrator session: each `@jamie` starts one,
   unless it replies to one of Jamie's posts or is posted in a thread one of
   them went into; then it continues the conversation that post came from
   (its `thread`). Every message to Jamie needs the `@jamie`, in its threads
   too: one without it is the members talking among themselves, and Jamie
   leaves it alone. (Until 2026-10-30 any message in Jamie's thread went to
   it.) The linker sees each one in Hive. (Until 2026-10-29 a tribe had one conversation, so every mention
   landed in one session.)

6. **Hive never calls Jamie.** Jamie makes every call, as voice does: it
   posts mentions and long-polls an outbox. So the daemon runs anywhere with
   outbound internet and needs no route to it. A join or a leave reaches it
   the same way, as an outbox entry. Its admin API listens on 127.0.0.1, for
   whoever runs it.

## How it works

### Linking

1. In Peel, the owner picks an org. Peel calls
   `POST /api/strut-devices/tribes { workspace, tribe: { pubkey, host } }`
   with the device credential (`hivedev_…`).
2. Hive does the checks `startCall` does (`lib/calls/startCall.ts`): the
   person, the workspace, its org. It stores the link, and puts a join for
   Jamie in the outbox: `{ id, join: "<tribe link>" }`. It answers
   `{ jamie: { pubkey, alias } }`, from its config (`JAMIE_SPHINX_PUBKEY`,
   which the daemon prints when it starts).
3. Jamie takes the join on its next poll, within seconds. It reads the
   tribe's info from the tribe's own host (`GET https://<host>/tribes/<pubkey>`:
   route hint, prices, private), so nothing Peel sends sets a price. It
   joins: `GroupJoin` for a public tribe, `MemberRequest` for a private one.
4. For a private tribe, Jamie shows up in the owner's pending members.
   Peel matches the `jamie.pubkey` Hive returned and approves it
   (`Engine.answerJoinRequest(in:_:approve: true)`, `PeelCore/Engine+Tribes.swift`).
   Jamie answers in that tribe only from the approval on.
5. **No Jamie** → `DELETE /api/strut-devices/tribes/<pubkey>`. Hive drops the
   link, and refuses that tribe's mentions from then on (a 4xx, which Jamie
   drops). It also puts `{ id, leave: "<tribe pubkey>" }` in the outbox.
   Leaving isn't built in sphinx-chat yet; until it is, the owner removes
   Jamie like any member.

`GET /api/strut-devices/tribes` lists the person's links, so their Mac and
iPhone show the same pick. The calls pick (`Setting.callJamie`) stays per
device as it is.

### A mention

1. **Jamie forwards it.** As a member, Jamie receives every message of the
   tribes it is in. A text message mentions it when it has `@jamie` at the
   start or after whitespace, in any case. `@jamie_2` counts too: a tribe
   whose members already use the alias renames the account that way. The
   daemon passes over:
   - its own messages;
   - what came before it could answer there (its join, or the owner's
     approval), judged by each message's own `date`. A tribe's history
     replay arrives stamped with the replay's time;
   - anything over a day old.

   It takes each mention once, across restarts, and calls
   `POST /api/tribes/messages` with its token:

   ```json
   {
     "id": "<the message id members hold>",
     "tribe": { "pubkey": "02…", "name": "Builders", "host": "tribes.v2.sphinx.chat" },
     "alias": "Alice",
     "owner": false,
     "time": "2026-10-29T18:02:11Z",
     "text": "@jamie what did we decide about the launch?",
     "recent": [{ "alias": "Bob", "time": "…", "text": "…" }],
     "attachments": [{ "name": "image.jpg", "mediaType": "image/jpeg", "data": "<base64>" }]
   }
   ```

   `recent` is the room since Jamie last spoke there, oldest first: up to
   30 lines and 8 KB, the newest that fit. `owner` is whether the tribe's
   owner wrote it; the tribe server marks the owner's messages.
   `attachments` is there when the mention carried a file (or the member
   posted captionless ones just before it): the daemon downloads and
   decrypts each from the memes server as an app does and sends it as
   base64 — an image shrunk to what a vision model reads, a PDF, a text
   file or a Word document as it is, under the sender's name for it; at most
   four and 3 MB together, so the request stays under Vercel's 4.5 MB body
   limit — or with `error` saying why it could not be opened (a video, a
   recording). Hive stores each under the workspace's canvas uploads like
   `recent`, puts it on the user row and the launch (strut shows an image
   or a PDF to the agent as a file part, text and Word inline), and names
   an unopened file after the message.

   **Removed from the tribe.** The owner may kick Jamie, or delete the
   tribe. The daemon leaves it and calls `POST /api/tribes/left { tribe,
   reason: "kicked" | "deleted" }` once; Hive drops the link as an unlink
   does, so the tribe shows unlinked in Peel and its mentions and log are
   refused. A 404 (not linked any more) is done for the daemon too.
2. **Hive takes the turn.** It is the call turn route's `takeTurn`, with the
   link in place of the call record:
   - drop an `id` already seen, a retry whose first answer was lost (2xx);
   - check the linker can still use the workspace. If not, refuse with a
     403, which Jamie drops, and put one line saying so in the outbox;
   - pick the conversation (`TribeThread`): the one the message's `thread`
     names, when it is this tribe's; else the one this mention started on an
     earlier try; else a new one;
   - refuse with 409 `busy` while that conversation has a turn live, as calls
     do. Turns of different conversations run side by side. Jamie holds
     every new mention in that conversation's thread, and offers them again
     once a reply lands, or every 15 s, as ONE mention: the newest as the
     mention, and the ones that waited before it as `earlier` (`[{ id,
     alias, owner, time, text }]`, oldest first; at most 20, and 20k chars
     with the newest, else a 400). A 429 or 5xx is a retry the same way; any
     other 4xx is dropped;
   - save `"<alias>: <text>"` on that conversation
     (`persistCanvasUserMessage`), one line per message of a burst, the
     newest last, in one user row. `recent` goes with it as a text
     attachment, as calls attach their transcript excerpt;
   - `launchOrchestratorTurn({ …, tribe: { name } })`. A tribe line goes
     beside `ORCHESTRATOR_CALL_LINE`: *"Asked in the Sphinx tribe #<name> by
     <alias>. Your reply is posted there, where not everyone is in this org."*
   - record the mention's `id` against the turn, so the reply threads under
     it, and each `earlier` id as taken too (`folded`), so a retry of any of
     them is a duplicate; one a turn already took is left out of the burst.

### The reply

1. **Jamie long-polls Hive** with one loop for every tribe:
   `GET /api/tribes/outbox?wait=25`. Hive answers with the new messages of
   every tribe conversation updated since that conversation's cursor. It
   reads them with `callMessagesSince` (`lib/calls/callMessages.ts`), the
   reader voice uses:

   ```json
   { "messages": [{ "id": "…", "tribe": "02…", "thread": "…", "text": "…", "replyTo": "…", "metadata": { "strut": { … } } }] }
   ```

   The `id` is Hive's, unique and stable, `<thread>:<row id>`, so an ack
   moves that conversation's cursor. `thread` is the conversation's key
   (the `TribeThread` id): Jamie keeps it against the message it posts, and
   sends it back on `POST /api/tribes/messages` with a mention that replies
   to that message or is posted in its thread.
2. **Jamie posts each one** into its tribe:
   - the text, then the deliverables as links;
   - `metadata`, as its JSON in the message's own `metadata` field:
     `{ strut: { workspace, artifacts } }`, the field the call chat carries
     (voice PR #20);
   - threaded under `replyTo`, and split into type-34 chunks past 869 bytes.
     The whole message, metadata included, is what is chunked.

   Then it acks with `POST /api/tribes/outbox/ack { ids }`. Delivery is at
   least once: Jamie keeps the ids it posted, so one handed out again is
   acked again, never posted twice. A message that fails to post isn't acked
   and comes back on the next poll; after 3 failures it is acked and
   dropped.
3. **A job's wake** three hours later lands on the same conversation, so the
   same loop posts it. Nobody needs to be online. The post carries the job's
   deliverables, read from the job's row (the card Hive's chat draws; the
   wake turn's own run holds none of the job's work): its cards but Hive's
   own (claims, trace) as links, and strut's entries as `metadata`.
4. A failed turn is an `error` message ("I couldn't finish that: …"). A
   proposal is "Waiting for <linker> to approve: <title>". The linker decides
   it in Hive.

### Deliverables

- **Everyone sees text and links.** A deliverable with an address of its
  own (a pull request, a page) links there. Anything else links into the
  post's conversation in Hive (`callArtifactUrl`), which opens for org
  members.
- **In Peel**, the `strut` field is resolved against the viewer's own
  pairing with that workspace, as the call chat does (`CallChat.artifacts`,
  `PeelCore/CallChat.swift`). Org members open the file in Peel; everyone
  else sees the titles.
- **Forged entries.** A tribe message's sender can't be verified (alias
  only), so any member could forge a `strut` field. An entry only opens
  against the viewer's own org with their own token, so a forged one shows
  nothing they couldn't already open. Apps open behind a confirm.

### The log

Added 2026-10-30. A linked tribe's messages also go to the org's strut, so
the org's graph holds what was said there. Linking a tribe is the consent;
there is no separate switch. Everything is sent from the link on, never the
history the tribe replays to a new member. It is the call transcript's flow
(`/api/calls/transcript`):

- **The daemon** (`DAEMON_LOG=on`) sends every message in a tribe it is in,
  members' and its own, to `POST /api/tribes/log`. It sends them oldest
  first, about a minute or 50 messages at a time, with its own cursor per
  tribe. A batch carries an id the daemon makes, so a retry is the same
  batch: `{ batch, tribe: { pubkey, name }, messages: [{ id, time, alias,
  owner, mine, text, replyTo?, thread? }] }`. A message deleted after a
  batch carried it (by its sender, or the owner) goes again as `{ id, …,
  text: "", deleted: true }`: what the workflow kept under that `id` goes.
  One deleted while it still waited in the daemon never goes.
- **Hive** looks up the link and checks the linker can still use the
  workspace. It then launches the workflow `TRIBE_MESSAGES_STRUT_WORKFLOW_NAME`
  names, on the org default, as the linker (`dispatchStrutRun`, kind and
  purpose `tribe_messages`). The batch is the run's attachment,
  `tribe-messages.jsonl`, and Hive keeps no copy. With the env unset the
  answer is `{ status: "off" }`. A retry of a batch gets the first answer.
- **The swarm** has `tribe-messages`, seeded by the lab (stakwork/stakgraph
  `mcp/src/lab/tribes/`). It is a placeholder that returns what arrived, as
  `call-transcript` is. What it keeps should be keyed by the message `id`,
  so a batch sent twice changes nothing.

### Money

The core refuses a tribe message without sats (`sphinx/src/bindings/send.rs`).
So every message Jamie sends costs at least 1 sat, even in a free tribe.
That includes every chunk of a long one: about 325 bytes of room per chunk
with the alias "Jamie". Measured in a free tribe in step 0:

| | Sats |
|---|---|
| Joining | 1 |
| A short reply | 1 |
| A 3.2 KB reply | 11 (11 chunks) |

Replies that carry deliverables in `metadata` run long, so expect 5–15 sats
a reply. In a priced tribe, sphinx-chat pays the full price on every chunk,
while the tribe server checks the price only on whole messages (it exempts
chunks, `tribes/src/forward.rs`). So Jamie overpays there; that wasn't
tested. Jamie pays from one balance for every org. Whoever runs it tops it
up with an invoice from the daemon's `POST /invoice`.

### Step 0, 2026-10-29

The daemon ran in echo mode (it answers a mention itself, no Hive) on
broker.v2.sphinx.chat, in a public free tribe:
- it joined;
- it answered `@Jamie hello` threaded under the message, with the owner
  flagged;
- it left a plain `hello` alone;
- it sent a 3.2 KB reply as 11 chunks.

Both replies showed threaded, and the long one as one message, in Peel and
in the official app. Two fixes came out of it, both in #401:
- the committed wasm core predated the chunk message type, so no long
  message could be sent (sphinx-chat 0.1.1 has the same bug);
- a tribe's history replay looks new unless it is judged by each message's
  own `date`.

## Work, by repo

### Hive

1. **The `TribeLink` model:**

   | Field | Note |
   |---|---|
   | `tribePubkey` | unique |
   | `tribeHost`, `name` | |
   | `orgId`, `workspaceSlug` | |
   | `userId` | the linker |
   | `createdAt` | |

   And one `TribeThread` per conversation of a tribe:

   | Field | Note |
   |---|---|
   | `id` | the `thread` Jamie holds |
   | `tribeLinkId` | |
   | `conversationId` | unique |
   | `mentionId?` | the mention that started it, so its retry lands there |
   | `cursor?` | what Jamie has posted |
   | `readAt?` | the conversation's `updatedAt` at a read that left nothing |
   | `createdAt` | |

   A relink to another org drops the link's threads; the conversations stay
   in Hive.
2. **`GET/POST/DELETE /api/strut-devices/tribes`**: the device credential,
   a `webhook` route in the middleware like `/api/strut-devices/calls`. POST
   queues Jamie's join and answers its pubkey. DELETE queues its leave.
3. **`POST /api/tribes/messages`**: Jamie's token. The call turn route's flow
   on a link: dedupe by `id`, the linker's access, busy, persist, launch with
   the tribe line, record the mention's `id`.
4. **`GET /api/tribes/outbox` and `POST /api/tribes/outbox/ack`**:
   `callMessagesSince` over each tribe conversation, reading only
   conversations updated after their own `readAt`. Also the queued joins and
   leaves, and the one-line notices (a linker who lost access).
5. **Config:** `JAMIE_SERVICE_TOKEN`, the token Jamie sends (the daemon's
   `DAEMON_SERVICE_TOKEN`), and `JAMIE_SPHINX_PUBKEY`. `V2_BOT_URL` stays the
   DM bot's.
6. **Tests:** route tests shaped like the calls ones.

### stakwork/sphinx

Built in #401:
- **`wasm/daemon`**: the account kept connected, mentions to the service,
  the outbox, the per-tribe queue for `busy`, and the ids already taken and
  posted. Its README documents the contract.
- **The rebuilt wasm core.**
- **sphinx-chat 0.1.2**, whose code it runs: `metadata` on a send, and a
  tribe message's owner flag and first `date`.

Still to add:
1. **Outbox `join` and `leave` entries.** The daemon joins by link today
   only through its admin API.
2. **Leaving a tribe.** sphinx-chat has no leave yet.
3. **Deployment.** One container, beside Hive's other services:
   - a volume for `SPHINX_HOME`;
   - `DAEMON_ALIAS=Jamie`;
   - `DAEMON_SERVICE_URL=https://hive.sphinx.chat/api/tribes`;
   - `DAEMON_SERVICE_TOKEN`.

   It needs outbound internet only, and one process serves every tribe.

### stakwork/peel

1. **Picker.** A Jamie row in tribe details, owner only, using the calls org
   picker (`stadeum.live`) with **No Jamie**. It is preselected the way calls
   are (`HivePeer.jamie(picked:pages:in:)`: the tribe's `second_brain_url`).
2. **Hive client.** `Stadeum`: link, unlink and list over the device
   credential, beside `callLink(on:)`.
3. **Approval.** When a pending member's pubkey is the linked Jamie's,
   approve it without a prompt.
4. **Rendering.** Show Jamie's replies' `strut` field in tribes as the call
   chat does. This is a new, narrow rule beside "control lines are never shown
   in a tribe": deliverables only, apps behind a confirm.

### No change

The tribe server, the Sphinx core, strut, sphinx-voice.

## Open questions

1. **Public tribes.** Anyone who joins a public tribe can drive the linker's
   org orchestrator, jobs included. Allow linking private tribes only in v1,
   or link a public one behind a warning?
2. **Jobs from a tribe.** Calls start jobs without asking. For tribe turns,
   Hive could add `job/start` to the turn's `approve` list in the launch's
   `params`, as it already passes `params.model`. Each job would then be a
   proposal the linker accepts: safer, but one more step per job.
3. **What Jamie says in a mixed room.** The tribe line tells the orchestrator
   that not everyone is in the org. Is that enough, or do tribe turns need a
   narrower set of tools?
4. **Funding.** Who tops up Jamie's balance, and whether Hive refuses to
   link a tribe whose prices are over a cap. At 5–15 sats a reply in a free
   tribe, a busy tribe spends a few thousand sats a month.
5. **One Jamie, or one per org.** One account for every org is simplest. A
   Jamie per org (its own name and photo) means more accounts, and Hive
   assigns each tribe to one; nothing else changes.
6. **Each asker as themselves, later.** Peel can sign a mention with the
   sender's key in `metadata`, and Hive checks it against
   `User.lightningPubkey`. Peel users then count as themselves; anyone else
   falls back to the linker. No tribe-server change. Hive's lookup by
   pubkey is a linear decrypt-and-compare today, so it needs an index.
7. **Chunks in a priced tribe.** In a free tribe, every chunk costs 1 sat
   (step 0). In a priced one, should sphinx-chat pay the price on the first
   chunk only, since the server exempts the rest? It needs a test against a
   priced tribe first.

## Rollout

1. stakwork/sphinx#401 (step 0 passed), then the outbox `join` / `leave`
   entries and the container. Publish sphinx-chat 0.1.2 after the merge.
2. Hive: the model and routes. Off until `JAMIE_SERVICE_TOKEN` is set.
3. Peel: the picker, the approval and the rendering.
4. One private test tribe on the v2 broker: link it, mention Jamie, close the
   phone, and check a job's result lands in the tribe.
