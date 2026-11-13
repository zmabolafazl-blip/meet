const TOKEN_PREFIX = 'webinarflow_token_';
const $ = (id) => document.getElementById(id);

async function api(url, data) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'درخواست انجام نشد.');
  return result;
}

function basePath() {
  return window.location.pathname.replace(/\/[^/]*$/, '');
}

async function createRoom(event) {
  event.preventDefault();
  const button = $('hostSubmit');
  const error = $('formError');
  if (error) error.textContent = '';
  if (button) button.disabled = true;
  try {
    const result = await api('/api/rooms', {
      title: $('meetingTitle').value.trim(),
      hostName: $('hostName').value.trim(),
      pin: $('pinCode').value.trim(),
      capacity: $('capacity').value
    });
    sessionStorage.setItem(`${TOKEN_PREFIX}${result.room.id}`, result.token);
    window.location.href = `${basePath()}/room.html?id=${encodeURIComponent(result.room.id)}&role=host`;
  } catch (err) {
    if (error) error.textContent = err.message;
    else alert(err.message);
  } finally {
    if (button) button.disabled = false;
  }
}

async function joinRoom(event) {
  event.preventDefault();
  const button = $('joinSubmit');
  const error = $('formError');
  if (error) error.textContent = '';
  if (button) button.disabled = true;
  try {
    const roomId = $('roomId').value.trim();
    const result = await api(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
      name: $('guestName').value.trim(),
      pin: $('joinPin').value.trim()
    });
    sessionStorage.setItem(`${TOKEN_PREFIX}${result.room.id}`, result.token);
    sessionStorage.setItem(`webinarflow_name_${result.room.id}`, $('guestName').value.trim());
    window.location.href = `${basePath()}/room.html?id=${encodeURIComponent(result.room.id)}&role=guest`;
  } catch (err) {
    if (error) error.textContent = err.message;
    else alert(err.message);
  } finally {
    if (button) button.disabled = false;
  }
}

function setupJoinPage() {
  const roomId = new URLSearchParams(location.search).get('room');
  if (roomId && $('roomId')) $('roomId').value = roomId;
}

function addMessage({ sender, role, text, at }) {
  const box = $('chatBox');
  if (!box) return;
  const row = document.createElement('div');
  row.className = 'chat-message';
  const heading = document.createElement('strong');
  heading.textContent = `${sender}${role === 'host' ? ' (مدیر)' : ''}: `;
  const body = document.createElement('span');
  body.textContent = text;
  row.append(heading, body);
  if (at) {
    const time = document.createElement('small');
    time.textContent = new Date(at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    row.appendChild(time);
  }
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

function setupMeeting() {
  if (!$('videoGrid')) return;
  const params = new URLSearchParams(location.search);
  const roomId = params.get('id');
  const role = params.get('role');
  const token = sessionStorage.getItem(`${TOKEN_PREFIX}${roomId}`);
  const status = $('connectionStatus');
  const videoGrid = $('videoGrid');
  const localVideo = $('localVideo');
  const peers = new Map();
  const pendingCandidates = new Map();
  let socket;
  let localStream;
  let screenTrack;

  if (!roomId || !token || typeof io !== 'function') {
    if (status) status.textContent = 'ورود معتبر نیست؛ از لینک دعوت وارد شوید و PIN را وارد کنید.';
    return;
  }

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      ...(window.WEBINAR_TURN_SERVERS || [])
    ]
  };

  function addVideoTile(id, name, isLocal = false) {
    let tile = document.getElementById(`tile-${id}`);
    if (tile) return tile;
    tile = document.createElement('div');
    tile.className = `video-tile${isLocal ? ' local-tile' : ''}`;
    tile.id = `tile-${id}`;
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = isLocal;
    const label = document.createElement('span');
    label.className = 'tile-name';
    label.textContent = name;
    tile.append(video, label);
    videoGrid.appendChild(tile);
    return tile;
  }

  function removePeer(id) {
    const peer = peers.get(id);
    if (peer) peer.pc.close();
    peers.delete(id);
    document.getElementById(`tile-${id}`)?.remove();
  }

  function makePeer(id, name) {
    if (peers.has(id)) return peers.get(id);
    const pc = new RTCPeerConnection(rtcConfig);
    const entry = { pc, name };
    peers.set(id, entry);
    localStream?.getTracks().forEach((track) => pc.addTrack(track, localStream));
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && socket?.connected) socket.emit('signal', { targetId: id, candidate });
    };
    pc.ontrack = ({ streams }) => {
      const tile = addVideoTile(id, entry.name);
      const video = tile.querySelector('video');
      if (video.srcObject !== streams[0]) video.srcObject = streams[0];
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') status.textContent = 'اتصال برقرار نشد؛ ممکن است سرور TURN لازم باشد.';
    };
    return entry;
  }

  async function sendOffer(id, name) {
    const entry = makePeer(id, name);
    const offer = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(offer);
    socket.emit('signal', { targetId: id, description: entry.pc.localDescription });
  }

  async function handleSignal({ fromId, description, candidate }) {
    if (candidate) {
      const entry = peers.get(fromId);
      if (!entry || !entry.pc.remoteDescription) {
        const queued = pendingCandidates.get(fromId) || [];
        queued.push(candidate);
        pendingCandidates.set(fromId, queued);
        return;
      }
      await entry.pc.addIceCandidate(candidate).catch(console.error);
      return;
    }
    if (!description) return;
    const entry = makePeer(fromId, 'شرکت‌کننده');
    await entry.pc.setRemoteDescription(description);
    const queued = pendingCandidates.get(fromId) || [];
    for (const item of queued) await entry.pc.addIceCandidate(item).catch(console.error);
    pendingCandidates.delete(fromId);
    if (description.type === 'offer') {
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      socket.emit('signal', { targetId: fromId, description: entry.pc.localDescription });
    }
  }

  async function start() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localVideo.srcObject = localStream;
    } catch (error) {
      console.warn('Camera/microphone unavailable:', error);
      status.textContent = 'دسترسی دوربین/میکروفون داده نشد. برای تماس تصویری اجازه دهید و صفحه را تازه‌سازی کنید.';
      return;
    }

    socket = io({ auth: { token } });
    socket.on('connect', () => { status.textContent = 'متصل به جلسه'; });
    socket.on('connect_error', (error) => { status.textContent = error.message || 'خطا در اتصال'; });
    socket.on('room-error', (message) => { status.textContent = message; });
    socket.on('room-state', ({ room, self, peers: existing }) => {
      $('roomTitle').textContent = room.title;
      $('localName').textContent = `${self.name} (شما)`;
      existing.forEach(({ id, name }) => {
        const entry = makePeer(id, name);
        entry.name = name;
        sendOffer(id, name).catch(console.error);
      });
      addMessage({ sender: 'سیستم', role: 'system', text: `به جلسه «${room.title}» خوش آمدید.` });
    });
    socket.on('peer-joined', ({ id, name }) => {
      const entry = makePeer(id, name);
      entry.name = name;
      sendOffer(id, name).catch(console.error);
    });
    socket.on('signal', (data) => handleSignal(data).catch(console.error));
    socket.on('peer-left', ({ id }) => removePeer(id));
    socket.on('participants', (participants) => {
      const list = $('participantsSidebar');
      list.replaceChildren();
      $('participantCount').textContent = String(participants.length);
      participants.forEach((person) => {
        const item = document.createElement('li');
        item.textContent = `${person.name}${person.role === 'host' ? ' (مدیر)' : ''}`;
        list.appendChild(item);
        const peer = peers.get(person.id);
        if (peer) {
          peer.name = person.name;
          const label = document.querySelector(`#tile-${CSS.escape(person.id)} .tile-name`);
          if (label) label.textContent = person.name;
        }
      });
    });
    socket.on('chat-message', addMessage);
    socket.on('disconnect', () => { status.textContent = 'اتصال قطع شد؛ تلاش برای اتصال مجدد...'; });
  }

  $('chatForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('chatInput');
    const text = input.value.trim();
    if (text && socket?.connected) socket.emit('chat-message', text);
    input.value = '';
  });

  $('toggleMic')?.addEventListener('click', (event) => {
    const track = localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    event.currentTarget.textContent = track.enabled ? '🎙️ میکروفون روشن' : '🔇 میکروفون خاموش';
  });
  $('toggleVideo')?.addEventListener('click', (event) => {
    const track = localStream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    event.currentTarget.textContent = track.enabled ? '📷 ویدیو روشن' : '🚫 ویدیو خاموش';
  });
  $('shareScreen')?.addEventListener('click', async () => {
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenTrack = screen.getVideoTracks()[0];
      for (const { pc } of peers.values()) {
        const sender = pc.getSenders().find((item) => item.track?.kind === 'video');
        if (sender) await sender.replaceTrack(screenTrack);
      }
      localVideo.srcObject = screen;
      screenTrack.onended = async () => {
        const cameraTrack = localStream.getVideoTracks()[0];
        for (const { pc } of peers.values()) {
          const sender = pc.getSenders().find((item) => item.track?.kind === 'video');
          if (sender) await sender.replaceTrack(cameraTrack);
        }
        localVideo.srcObject = localStream;
      };
    } catch (error) {
      if (error.name !== 'NotAllowedError') status.textContent = 'اشتراک‌گذاری صفحه انجام نشد.';
    }
  });
  $('shareLinkBtn')?.addEventListener('click', async () => {
    const link = `${location.origin}${basePath()}/join.html?room=${encodeURIComponent(roomId)}`;
    try {
      await navigator.clipboard.writeText(link);
      status.textContent = 'لینک دعوت کپی شد؛ PIN را جداگانه برای مهمان بفرستید.';
    } catch {
      prompt('لینک دعوت (PIN را جداگانه ارسال کنید):', link);
    }
  });
  $('leaveRoomBtn')?.addEventListener('click', () => {
    socket?.disconnect();
    localStream?.getTracks().forEach((track) => track.stop());
    screenTrack?.stop();
    sessionStorage.removeItem(`${TOKEN_PREFIX}${roomId}`);
    sessionStorage.removeItem(`webinarflow_name_${roomId}`);
    location.href = `${basePath()}/index.html`;
  });

  start();
}

document.addEventListener('DOMContentLoaded', () => {
  $('hostForm')?.addEventListener('submit', createRoom);
  $('joinForm')?.addEventListener('submit', joinRoom);
  setupJoinPage();
  setupMeeting();
});
