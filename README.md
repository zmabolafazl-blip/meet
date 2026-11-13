# WebinarFlow

A Persian RTL webinar/meeting prototype with server-backed room creation, PIN verification, real-time signaling, WebRTC media, chat, and screen sharing.

## Run locally

Requires Node.js 20 or newer. From the repository directory:

```bash
npm install
npm start
```

Open <http://localhost:3000>. Create a room, copy the invite link from inside the room, and send the PIN separately. The guest opens the invite link, enters their name and PIN, and joins.

For local development, camera/microphone access is available on `localhost`. A deployed site must use HTTPS.

## What is real in this version

- Rooms and PIN verification run through the Express server; PINs are salted and hashed with scrypt.
- Socket.IO handles authenticated room membership, participant updates, chat, and WebRTC offer/answer/ICE signaling.
- Browser WebRTC transmits camera/microphone media peer-to-peer. Screen sharing is also supported.
- The host invite URL does not include the PIN; share the PIN separately.

## Important limitations before production

- Rooms, tokens, and PIN hashes are kept in process memory. A server restart clears active rooms, and this single-process prototype is not horizontally scalable.
- This peer-to-peer mesh implementation is intentionally capped at eight participants. For larger webinars, replace mesh media with an SFU service (for example LiveKit, mediasoup, or Janus).
- STUN alone cannot connect every network. Configure a TURN service for reliable cross-network connectivity. Set `window.WEBINAR_TURN_SERVERS` before `assets/app.js` to an array of ICE server objects, for example `{ urls, username, credential }`; do not commit TURN credentials to a public repository.
- Before real public use, add persistent storage, user authentication, room expiration, moderation controls, rate limiting at a proxy, logging/monitoring, and a managed TURN/SFU deployment. Use HTTPS.
- Do not use this prototype to handle sensitive meetings without completing a security and privacy review.

## Deployment

Run `npm install` and `npm start` on a Node.js host that supports long-lived WebSocket connections. Configure HTTPS at the hosting provider or reverse proxy and set `PORT` as required. `PUBLIC_ORIGIN` can be set to the exact public origin if cross-origin access is needed; by default the app is intended to be served from one origin.
