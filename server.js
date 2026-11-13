const crypto = require('node:crypto');
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e6,
  cors: { origin: process.env.PUBLIC_ORIGIN || false }
});
const PORT = Number(process.env.PORT) || 3000;
const MAX_PARTICIPANTS = 8; // Mesh WebRTC is only suitable for small meetings.
const rooms = new Map();
const accessTokens = new Map();
const pinAttempts = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use(express.static(__dirname, { extensions: ['html'] }));

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pin, salt, 64, (error, key) => {
      if (error) return reject(error);
      resolve({ salt, hash: key.toString('hex') });
    });
  });
}

function verifyPin(pin, stored) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pin, stored.salt, 64, (error, key) => {
      if (error) return reject(error);
      const expected = Buffer.from(stored.hash, 'hex');
      resolve(expected.length === key.length && crypto.timingSafeEqual(expected, key));
    });
  });
}

function publicRoom(room) {
  return {
    id: room.id,
    title: room.title,
    hostName: room.hostName,
    capacity: room.capacity,
    createdAt: room.createdAt
  };
}

function activeCount(roomId) {
  return io.sockets.adapter.rooms.get(roomId)?.size || 0;
}

function pinRateLimited(ip) {
  const now = Date.now();
  const attempt = pinAttempts.get(ip);
  if (!attempt || now - attempt.startedAt > 10 * 60 * 1000) {
    pinAttempts.set(ip, { startedAt: now, count: 1 });
    return false;
  }
  attempt.count += 1;
  return attempt.count > 20;
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/rooms', async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 100);
  const hostName = String(req.body?.hostName || '').trim().slice(0, 60);
  const pin = String(req.body?.pin || '').trim();
  const capacity = Math.min(MAX_PARTICIPANTS, Math.max(2, Number(req.body?.capacity) || MAX_PARTICIPANTS));

  if (!title || !hostName || !/^\d{4,8}$/.test(pin)) {
    return res.status(400).json({ error: 'عنوان، نام مدیر و PIN چهار تا هشت‌رقمی لازم است.' });
  }

  try {
    const id = crypto.randomBytes(6).toString('base64url');
    const pinHash = await hashPin(pin);
    const room = { id, title, hostName, pinHash, capacity, createdAt: new Date().toISOString() };
    const token = randomToken();
    rooms.set(id, room);
    accessTokens.set(token, { roomId: id, name: hostName, role: 'host' });
    res.status(201).json({ room: publicRoom(room), token });
  } catch (error) {
    console.error('Could not create room:', error);
    res.status(500).json({ error: 'ساخت جلسه با خطا روبه‌رو شد.' });
  }
});

app.post('/api/rooms/:id/join', async (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) return res.status(404).json({ error: 'جلسه پیدا نشد یا سرور آن راه‌اندازی مجدد شده است.' });

  const name = String(req.body?.name || '').trim().slice(0, 60);
  const pin = String(req.body?.pin || '').trim();
  const ip = req.ip || 'unknown';
  if (pinRateLimited(ip)) return res.status(429).json({ error: 'تعداد تلاش‌ها زیاد است؛ چند دقیقه دیگر دوباره تلاش کنید.' });
  if (!name || !/^\d{4,8}$/.test(pin)) return res.status(400).json({ error: 'نام و PIN معتبر وارد کنید.' });

  try {
    if (!(await verifyPin(pin, room.pinHash))) {
      return res.status(403).json({ error: 'PIN جلسه درست نیست.' });
    }
    if (activeCount(room.id) >= room.capacity) {
      return res.status(409).json({ error: 'ظرفیت این جلسه تکمیل است.' });
    }

    const token = randomToken();
    accessTokens.set(token, { roomId: room.id, name, role: 'guest' });
    res.json({ room: publicRoom(room), token });
  } catch (error) {
    console.error('Could not verify room PIN:', error);
    res.status(500).json({ error: 'ورود به جلسه با خطا روبه‌رو شد.' });
  }
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const identity = typeof token === 'string' ? accessTokens.get(token) : null;
  if (!identity || !rooms.has(identity.roomId)) return next(new Error('اجازه ورود به این جلسه وجود ندارد.'));
  socket.data.identity = identity;
  next();
});

io.on('connection', (socket) => {
  const identity = socket.data.identity;
  const room = rooms.get(identity.roomId);
  const currentRoom = io.sockets.adapter.rooms.get(room.id);
  if ((currentRoom?.size || 0) >= room.capacity) {
    socket.emit('room-error', 'ظرفیت این جلسه تکمیل است.');
    socket.disconnect(true);
    return;
  }

  const existingPeers = Array.from(currentRoom || []).map((id) => ({
    id,
    name: io.sockets.sockets.get(id)?.data.identity.name || 'مهمان'
  }));
  socket.join(room.id);
  socket.emit('room-state', { room: publicRoom(room), self: { name: identity.name, role: identity.role }, peers: existingPeers });
  socket.to(room.id).emit('peer-joined', { id: socket.id, name: identity.name });
  io.to(room.id).emit('participants', participantList(room.id));

  socket.on('signal', ({ targetId, description, candidate } = {}) => {
    if (typeof targetId !== 'string' || !io.sockets.sockets.has(targetId)) return;
    const target = io.sockets.sockets.get(targetId);
    if (target.data.identity.roomId !== identity.roomId) return;
    if (description && typeof description === 'object') {
      target.emit('signal', { fromId: socket.id, description });
    } else if (candidate && typeof candidate === 'object') {
      target.emit('signal', { fromId: socket.id, candidate });
    }
  });

  socket.on('chat-message', (text) => {
    if (typeof text !== 'string') return;
    const message = text.trim().slice(0, 500);
    if (!message) return;
    io.to(room.id).emit('chat-message', {
      sender: identity.name,
      role: identity.role,
      text: message,
      at: new Date().toISOString()
    });
  });

  socket.on('disconnect', () => {
    socket.to(room.id).emit('peer-left', { id: socket.id });
    io.to(room.id).emit('participants', participantList(room.id));
  });
});

function participantList(roomId) {
  return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map((id) => {
    const participant = io.sockets.sockets.get(id);
    return { id, name: participant?.data.identity.name || 'مهمان', role: participant?.data.identity.role || 'guest' };
  });
}

server.listen(PORT, () => {
  console.log(`WebinarFlow is running at http://localhost:${PORT}`);
});
