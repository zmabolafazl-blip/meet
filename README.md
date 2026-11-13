# WebinarFlow

This project is a demo frontend for a webinar platform inspired by modern meeting apps such as Google Meet and Zoom.

## Included pages

- `index.html` — landing page for the webinar website
- `host.html` — host creates a room with a title, PIN, and link
- `join.html` — guest/user join screen with room code and PIN
- `room.html` — interactive mock meeting room with chat and controls

## Features

- Landing page with hero section, pricing, and feature blocks
- Host creation flow for meetings
- PIN-based access control
- Room link generation
- Guest join flow
- Meeting-room mockup with participants and chat
- Local browser storage for generated rooms

## Run locally

Open the project in a browser directly, or start a simple local server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Notes

This is a front-end prototype and not a production real-time meeting backend. For a real webinar product, you would add WebRTC, Socket.IO, authentication, and a backend service.
