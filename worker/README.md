# The TRADDOMIUM relay

The server side of multiplayer: a Cloudflare Worker that routes players
into rooms, and one Durable Object per room that owns that room's truth.

**It implements no game rule.** Move validation, spawning, snapshots,
the disconnect grace and identity re-attach all live in
[`src/net/Host.ts`](../src/net/Host.ts) and run here *unchanged* — the
same file the browser runs and the same file
[`tests/netReplication.test.ts`](../tests/netReplication.test.ts) drives
over a loopback wire. That is the whole point of `Host` being pure (no
`three`, no DOM, no node): one core, two authorities
(`docs/ARCHITECTURE.md` §5). Everything in `worker/` is the three things
`Host` deliberately lacks — a socket, a clock, and something to call
`tick()`.

```
worker/src/index.ts               the router: /health and /room/<code>
worker/src/RoomDurableObject.ts   one room = one Durable Object = one Host
worker/src/WebSocketTransport.ts  a workerd WebSocket wearing net/Transport
worker/src/roomCode.ts            what a room code is, and what it is not
```

## Routes

| Route | Answer |
|---|---|
| `GET /health` | JSON: the service name, the version, the protocol message kinds, the snapshot rate, the disconnect grace and the room-code rule. Readable from any origin. |
| `GET /room/<code>` with `Upgrade: websocket` | The room. `101`, then the protocol: the client sends `hello`, the room answers `welcome`. |
| `GET /room/<code>` without the upgrade header | `426` — a room is joined over a WebSocket. |
| A code that is not a code | `400`, in plain words. Never a `500`. |
| Anything else | `404`. |

A room code is 3–24 characters of `a-z`, `0-9` and `-`, starting and
ending with a letter or digit. It is matched case-insensitively, because
codes are said out loud: `RED-ANT-7` and `red-ant-7` are the same room,
and the same room is the same Durable Object, so both players land in
the same game.

## Run it locally

From the repository root:

```
npm install
npm run relay:dev
```

That starts `wrangler dev` in local mode — the real Workers runtime
(`workerd`) on your machine, with a local Durable Object. No Cloudflare
account, no login, no network. Check it:

```
curl http://127.0.0.1:8787/health
```

Prove the whole relay in about three seconds — no account, no browser:

```
npm run probe:relay
```

`scripts/probe-relay.mjs` starts its own `wrangler dev --local` on a free
port, opens two WebSockets into one room, and checks what a player would
meet in order: two capsules in the same room, a walk one sees the other
make, a teleport the authority refuses, a dropped link whose capsule
lingers through the grace, and a re-attach that returns the SAME actor.
It stops the Worker and removes its state whether it passes or fails.

Type-check the relay separately from the game (the game's tsconfig
targets the browser; this one targets the Workers runtime):

```
npm run relay:typecheck
```

## Deploy it

One command, from the repository root:

```
npm run relay:deploy
```

That is `wrangler deploy --config worker/wrangler.toml`. It publishes
`traddomium-relay` and applies the `v1` migration that creates the
`RoomDurableObject` class.

Durable Objects here are declared with `new_sqlite_classes`, which is the
form available on the **Workers free plan**; `new_classes` is the
paid-plan (key-value backed) form of the same declaration. The room keeps
nothing in storage either way — see the "why `accept()`" note in
`RoomDurableObject.ts`.

Watch a deployed relay's logs:

```
npm run relay:tail
```

### Credentials

**No credentials live in this repository.** `wrangler.toml` carries no
`account_id`, no API token and no secrets, and none should ever be added
to it.

Wrangler finds the account itself:

- on a laptop, from `npx wrangler login` (an OAuth browser flow);
- on CI, from the `CLOUDFLARE_API_TOKEN` environment variable, plus
  `CLOUDFLARE_ACCOUNT_ID` when the token can see more than one account.

An API token for deploying this relay needs, on the account that will
host it:

| Permission | Level | Why |
|---|---|---|
| **Workers Scripts** | Edit | upload and publish the Worker |
| **Account Settings** | Read | let wrangler resolve the account id |
| **Workers Tail** | Read | only if that token also runs `relay:tail` |

Durable Objects need no permission of their own: the migration is part of
the script upload, covered by Workers Scripts: Edit. Cloudflare's
"Edit Cloudflare Workers" template grants these and more; a token scoped
to the three rows above is enough and is the smaller blast radius.

## The address a client uses

A deployed relay answers at `https://traddomium-relay.<subdomain>.workers.dev`,
and a room on it is `wss://traddomium-relay.<subdomain>.workers.dev/room/<code>`.
That URL is the whole of what the browser needs: it goes to
`RemoteMultiplayerSession({ relayUrl })` (`src/session/`), which hands it
to `src/net/WebSocketTransport.ts`. `GET /health` on the same host names
the protocol kinds, the snapshot rate and the grace the relay is actually
running, so a client can check it is speaking the same protocol before it
opens a socket.

THE DEPLOYED RELAY IS COMPILED INTO THE BUILD. `vite.config.ts` bakes it
in as `__RELAY_URL__`, `src/ui/buildInfo.ts` reads it and
`src/net/relayConfig.ts` resolves it against `?relay=` — core is HANDED
the address rather than naming the constant, because the relay compiles
`src/net/` too and no define reaches it there. An ordinary
`npm run build` ships a game with rooms in it. Two overrides:
`TRADDOMIUM_RELAY_URL=` at BUILD time makes a build with no online play
at all (the honest mock, caption and all), and `?relay=` at RUN time
points a built page somewhere else —

    npm run relay:dev                      # this machine, port 8787
    …/index.html?relay=ws://127.0.0.1:8787 # the same build, that relay

which is exactly what `npm run probe:multiplayer` does with two browsers
and a relay it starts itself. An https page may only open a `wss://`
socket — a `ws://` address from a Pages build is blocked by the browser
as mixed content, and the transport's failure message names that case so
the reason is not a bare "closed".

## What the relay does not do

- It writes nothing to storage. A room's state lives in memory for as
  long as somebody is in it; once the last player leaves, nothing keeps
  it alive and the runtime is free to discard it, so an empty room may or
  may not still be there later. There are no persistent worlds yet and
  the relay does not pretend there are.
- It has no accounts, no authentication and no room passwords. Anyone
  who knows a code can join that room. A code is a meeting point, not a
  lock.
- It does not simulate anything on its own. Between snapshot rounds the
  room is idle; when it is empty, nothing is scheduled at all.
