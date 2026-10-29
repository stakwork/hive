# Jamie in Sphinx tribes

Status: **proposed** 2026-10-29.

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
                          │
tribe ◄── member ──► Jamie account ◄── mentions / replies ──► Hive ──► org's strut: orchestrator
```

- **Jamie is an ordinary member account**, one for every tribe of every org:
  Hive's existing v2 bot account (`V2_BOT_URL`, the `wasm/bot` image in
  stakwork/sphinx), extended. It knows nothing about orgs.
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
     bots.v2.sphinx.chat), has had no commits since 2024-08.

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

5. **One conversation per tribe**, a `SharedConversation` of the linker's,
   so Jamie keeps the room's thread across turns and the linker sees it in
   Hive.

## How it works

### Linking

1. In Peel, the owner picks an org. Peel calls
   `POST /api/strut-devices/tribes { workspace, tribe: { pubkey, host } }`
   with the device credential (`hivedev_…`).
2. Hive does the checks `startCall` does (`lib/calls/startCall.ts`): the
   person, the workspace, its org. It stores the link and asks the Jamie
   account to join (`POST {V2_BOT_URL}/join_tribe`). It answers
   `{ jamie: { pubkey, alias } }`.
3. The Jamie account reads the tribe's info from the tribe's own host
   (`GET https://<host>/tribes/<pubkey>`: route hint, prices, private), so
   nothing Peel sends sets a price. It joins: `GroupJoin` for a public tribe,
   `MemberRequest` for a private one.
4. For a private tribe, Jamie shows up in the owner's pending members.
   Peel matches the `jamie.pubkey` Hive returned and approves it
   (`Engine.answerJoinRequest(in:_:approve: true)`, `PeelCore/Engine+Tribes.swift`).
5. **No Jamie** → `DELETE /api/strut-devices/tribes/<pubkey>`. Hive drops the
   link and the account leaves the tribe.

`GET /api/strut-devices/tribes` lists the person's links, so their Mac and
iPhone show the same pick. The calls pick (`Setting.callJamie`) stays per
device as it is.

### A mention

1. **Jamie forwards it.** As a member, the Jamie account receives every
   message of the tribes it is in. For a text message (type 0, or chunks put
   back together) that mentions Jamie (`(?i)(^|\s)@jamie\b`, the pattern
   Peel's call chat and voice use), it calls
   `POST /api/tribes/messages { tribe, uuid, alias, role, date, text, recent }`
   with its own token. `recent` is the room since Jamie last spoke: the last
   messages of that tribe, capped (say 30 lines, 8 KB).
2. **Hive takes the turn.** It is the call turn route's `takeTurn`, with the
   link in place of the call record:
   - drop a message dated before the link (the 35-message history a joiner
     is replayed) and a `uuid` already seen;
   - check the linker can still use the workspace (403 otherwise; Jamie says
     so once in the tribe);
   - refuse with 409 `busy` while a turn is live, as calls do. Jamie keeps a
     queue per tribe and sends the next mention once the reply has landed;
   - save `"<alias>: <text>"` on the tribe's conversation
     (`persistCanvasUserMessage`), with `recent` as a text attachment, as
     calls attach their transcript excerpt;
   - `launchOrchestratorTurn({ …, tribe: { name } })`. A tribe line goes
     beside `ORCHESTRATOR_CALL_LINE`: *"Asked in the Sphinx tribe #<name> by
     <alias>. Your reply is posted there, where not everyone is in this org."*
   - record the mention's `uuid` against the turn, so the reply threads on
     it.

### The reply

1. **Jamie long-polls Hive** with one loop for every tribe:
   `GET /api/tribes/outbox?wait=25`. Hive answers with the new messages of
   every linked conversation updated since that link's cursor. It reads them
   with `callMessagesSince` (`lib/calls/callMessages.ts`), the reader voice
   uses, unchanged. Each comes with `{ tribe, replyTo? }`.
2. **Jamie posts each one** into its tribe:
   - the text, then the deliverables as links;
   - `metadata: { strut: { workspace, artifacts } }`, the field the call chat
     carries (voice PR #20);
   - threaded on the mention, and split into type-34 chunks past 869 bytes.

   Then it acks with `POST /api/tribes/outbox/ack { tribe, cursor }`, and
   Hive moves the link's cursor. Delivery is at least once: Jamie keeps the
   ids it posted, so a retry is never posted twice.
3. **A job's wake** three hours later lands on the same conversation, so the
   same loop posts it. Nobody needs to be online.
4. A failed turn is an `error` message ("I couldn't finish that: …"). A
   proposal is "Waiting for <linker> to approve: <title>". The linker decides
   it in Hive.

### Deliverables

- **Everyone sees text and links.** A deliverable with an address of its
  own (a pull request, a page) links there. Anything else links into the
  tribe's conversation in Hive (`callArtifactUrl`), which opens for org
  members.
- **In Peel**, the `strut` field is resolved against the viewer's own
  pairing with that workspace, as the call chat does (`CallChat.artifacts`,
  `PeelCore/CallChat.swift`). Org members open the file in Peel; everyone
  else sees the titles.
- **Forged entries.** A tribe message's sender can't be verified (alias
  only), so any member could forge a `strut` field. An entry only opens
  against the viewer's own org with their own token, so a forged one shows
  nothing they couldn't already open. Apps open behind a confirm.

### Money

The core refuses a tribe message without sats (`sphinx/src/bindings/send.rs`).
So Jamie pays each tribe's join price, and its price per message on every
reply, from the account's balance. Hive keeps the account funded.

## Work, by repo

### Hive

1. **The `TribeLink` model:**

   | Field | Note |
   |---|---|
   | `tribePubkey` | unique |
   | `tribeHost`, `name` | |
   | `orgId`, `workspaceSlug` | |
   | `userId` | the linker |
   | `conversationId?` | |
   | `cursor?` | what Jamie has posted |
   | `createdAt` | |

   One migration.
2. **`GET/POST/DELETE /api/strut-devices/tribes`**: the device credential,
   a `webhook` route in the middleware like `/api/strut-devices/calls`. POST
   asks the Jamie account to join and answers its pubkey.
3. **`POST /api/tribes/messages`**: Jamie's token. The call turn route's flow
   on a link: dedupe, link date, busy, persist, launch with the tribe line,
   record the mention uuid.
4. **`GET /api/tribes/outbox` and `POST /api/tribes/outbox/ack`**:
   `callMessagesSince` over each link's conversation, reading only
   conversations updated after the link's cursor.
5. **Config:** Jamie's routes on the existing `V2_BOT_URL` / `V2_BOT_TOKEN`,
   and a new token for Jamie's calls into Hive.
6. **Tests:** route tests shaped like the calls ones.

### stakwork/sphinx (`wasm/bot`)

The image stays a generic Sphinx account. What follows only switches on
when the Hive URL is set.

1. **Receive.** `extra_handler` (`wasm/bot/utils.ts`) drops incoming messages
   today. Decode them and put chunks back together, reusing `wasm/chat`'s
   (`src/session.ts`, `src/chunk.ts`). Keep each joined tribe's recent
   messages, and forward a mention to Hive with `recent`.
2. **Send** (`routes.ts`, `send`):
   - `metadata` on a message;
   - type-34 chunks past `MAX_MSG_LEN`, ported from `wasm/chat/src/chunk.ts`;
   - the tribe's price per message, read from the tribe.
3. **Join and leave:**
   - `join_tribe` takes `private` (a `MemberRequest`, the core's
     `join_tribe(…, is_private)`) and reads the tribe's info from its host;
   - a `leave_tribe` route.
4. **Outbox:** the long-poll loop, the per-tribe queue for `busy`, and the
   ids already posted.
5. Alias `Jamie`.

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
4. **Funding.** How Jamie's balance is topped up, and a cap on the prices of
   tribes it joins.
5. **One Jamie, or one per org.** One account for every org is simplest. A
   Jamie per org (its own name and photo) means more accounts, and Hive
   assigns each tribe to one; nothing else changes.
6. **Each asker as themselves, later.** Peel can sign a mention with the
   sender's key in `metadata`, and Hive checks it against
   `User.lightningPubkey`. Peel users then count as themselves; anyone else
   falls back to the linker. No tribe-server change. Hive's lookup by
   pubkey is a linear decrypt-and-compare today, so it needs an index.
7. **Do chunks pay the price per message?** The tribe server exempts chunks
   (`tribes/src/forward.rs`, the price check), while `docs/sphinx-chat.md`
   says every chunk pays. This decides what a long reply costs.

## Rollout

1. stakwork/sphinx: the `wasm/bot` changes, and a new image.
2. Hive: the model and routes. Off until the Jamie account's token is set.
3. Peel: the picker, the approval and the rendering.
4. One private test tribe on the v2 broker: link it, mention Jamie, close the
   phone, and check a job's result lands in the tribe.
