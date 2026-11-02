# Sphinx tokens bound to Hive

Status: **proposed** 2026-11-01. Step 1 below, Hive taking both forms, is
built (`lib/auth/sphinx-verify.ts`, `lib/auth/sphinx-token-accept.ts`).

A Sphinx token proves a node key to Hive. Today it signs a timestamp and
nothing else, so a signature the key made for anyone else can be a Hive
login. The bound token signs Hive's host, what the token is for and the
challenge too. Hive takes both while the clients move, then only the bound
one.

## The problem

Four routes take a token (`verifySphinxToken`): base64 of a 4-byte
big-endian unix time and a 65-byte recoverable signature over
`"Lightning Signed Message:"` + those four bytes, double SHA-256, at most
five minutes old. Nothing in the signed bytes says Hive. **Any signature a
Sphinx client makes with its node key over four bytes is a valid Hive
token.**

That is a real path today. Peel's memes-server sign-in signs whatever
challenge the media server sends, with that key. A malicious media server
sends a 4-byte challenge equal to the current time and gets back a Hive
token for that person. With it, `POST /api/auth/sphinx/token` hands it a
30-day JWT as them, and `POST /verify/<k1>` with a k1 it asked Hive for signs
its own browser in as them. The QR route looks the k1 up and marks it used,
but the token never names it: the same signature works for any k1.

## The bound token

The same wire shape: base64 of the 4-byte big-endian timestamp and a 65-byte
recoverable signature (27 + recovery id, then r ‖ s; 31 + is read too). The
signed message is:

```
"Lightning Signed Message:" + utf8("hive sphinx token v2\n" + host + "\n" + purpose + "\n" + challenge + "\n") + the 4 timestamp bytes
```

double SHA-256, as today. Everything after the prefix is the payload
(`sphinxTokenBoundPayload`). Every Sphinx client can already sign it: the
core's `sign_base64(seed, idx, time, network, msg_base64)` adds the prefix
and makes this signature over any bytes.

- **host** is Hive's host as the sign-in QR's `host=` names it:
  `NEXTAUTH_URL`'s host, port included when not the default
  (`hive.sphinx.chat`, `localhost:3000`). Hive rebuilds it from its own
  config, never from the request when it has one (`sphinxTokenHost`). A
  client signs the host it was given: the QR's, or the Hive it paired with.
- **purpose** is `login` or `register`, by route (below).
- **challenge** is the k1 Hive issued (hex), or `""` where the route has
  none.
- Each field is one line. Hive refuses a binding with a newline in it.

The window is the bare token's: five minutes old at most, none from the
future.

| Route | Called by | purpose | challenge |
| --- | --- | --- | --- |
| `POST /verify/[challenge]?token=` | the Sphinx apps, after scanning the QR | `login` | the path's k1 |
| `POST /api/auth/sphinx/verify/[challenge]` | the same step, token in the body | `login` | the path's k1 |
| `POST /api/auth/sphinx/token` | a client trading a token for a 30-day JWT | `login` | `challenge` in the body |
| `POST /api/strut-devices/sphinx` | a paired Peel registering its pubkey | `register` | `""` |

**The token exchange takes a challenge now.** It had none, and a bound
token without one would still say nothing about which sign-in it was for.
So a bound token there names a k1 from `POST /api/auth/sphinx/challenge`
(the QR's), still live, in a `challenge` field. The exchange spends it:
`used`, with no pubkey, so the QR sign-in can never use it after. It spends
it whichever form the token is. With no challenge only the bare token goes
through, and only until the flag.

**Registration has no challenge.** The request carries the device's own
credential, and the token goes to Hive alone.

Each sign-in route answers `tokenFormat: "bare" | "bound"`. The device
route keeps `{ linked: true }`. Every route logs `Sphinx token accepted
{ purpose, format }` at info, never the token.

## The flag

`SPHINX_TOKEN_REQUIRE_BOUND=true` makes every route refuse the bare token:
`Bare Sphinx tokens are no longer accepted: sign the bound form (hive sphinx
token v2)`, with the route's usual status (401, the device route 400). Off
by default.

## What binding does

A bare token is four bytes, and any server a client signs a short challenge
for can ask for them. The only defence was every signer, everywhere,
refusing every 4-byte message. Peel's interim floor does that much for
Peel: it refuses a challenge under 8 bytes (the real memes challenge is a
10-digit decimal time). **It is not enough.** It protects only Peel's users,
and only against that one server. The official apps, and any other client
that signs a server's challenge, still hand out Hive tokens.

A bound token's message starts with a fixed line, `hive sphinx token v2`,
and names this Hive, this purpose and this k1. A signature made for anything
else, a bare token included, is not one. That leaves one rule for the
clients, and it is one they can keep: **a signer of other servers'
challenges refuses one that starts with `hive sphinx token`.** A k1 in the
message also makes a QR sign-in's token good for that sign-in only.

## Test vector

Pinned in `src/__tests__/unit/lib/auth/sphinx-verify.test.ts`.

- Key: 32 bytes of `0x11`. Pubkey
  `034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa`.
- Time: `1793491200` (2026-11-01T00:00:00Z), bytes `6ae68100`.

`login`, host `hive.sphinx.chat`, challenge `0123456789abcdef` four times:

```
payload  6869766520737068696e7820746f6b656e2076320a686976652e737068696e782e636861740a6c6f67696e0a303132333435363738396162636465663031323334353637383961626364656630313233343536373839616263646566303132333435363738396162636465660a6ae68100
base64   aGl2ZSBzcGhpbnggdG9rZW4gdjIKaGl2ZS5zcGhpbnguY2hhdApsb2dpbgowMTIzNDU2Nzg5YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVmCmrmgQA=
token    auaBABy0tOSbTyQ7W+rXRDmKMgm1Q7VZzll3JGR/VXpAOLkuDQdYEiO1OegJZE+OqQG4xGJOh3dsf0MLz7keru5x8w0d
```

`register`, host `hive.sphinx.chat`, no challenge:

```
payload  6869766520737068696e7820746f6b656e2076320a686976652e737068696e782e636861740a72656769737465720a0a6ae68100
base64   aGl2ZSBzcGhpbnggdG9rZW4gdjIKaGl2ZS5zcGhpbnguY2hhdApyZWdpc3RlcgoKauaBAA==
token    auaBAByQxtWo/KykbPKNapagyNjEBIc1SZxgmxyTlipNWw/bRSXkC79xHVCbkG1T4y2zQMeisUG506lOyW+RAYgnpd5L
```

The bare token at the same time is
`auaBABwRpTmF0GK9FaHq6hkrfMn/z7qfGCEUT6uRyJLzDhcBvTE0AR0yHhK999oJFNzrCEfYdlmFD2FSh7V3UIic2mUH`:
it verifies bare, and not bound. The tokens are noble's RFC 6979 signatures
with header 27 + recovery id. A client's payload must match these bytes
exactly; its signature may differ (another nonce, or 31 + recovery id) and
verifies the same.

## Rollout

1. **Hive takes both.** Built. A client sending the bare token sees nothing
   change but `tokenFormat`.
2. **Peel sends bound.** Its registration (peel#472) signs the `register`
   payload with `signBase64` in place of the bare timestamp; its
   registration test vector becomes the one above. Its future Hive logins
   sign `login` with the k1. Its challenge signer refuses
   `hive sphinx token`.
3. **The official apps' Hive sign-in sends bound** (sphinx-ios-v2,
   sphinx-mac-v2, Android): on `action=auth`, `sign_base64` over the payload
   with the QR's host and challenge, in place of `signed_timestamp`, and the
   same refusal in their challenge signers. Their `action=auth` is one flow
   for every host, so the change is per host (a Hive) or a v2 the other
   hosts take up too; the message already names the host.
4. **The flag turns on**, once the logs' `format` shows no bare tokens
   arriving.
5. **The bare verifier is deleted**, and the flag with it. Peel's 8-byte
   floor then protects nothing of Hive's.
