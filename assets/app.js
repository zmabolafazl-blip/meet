const STORAGE_KEY = 'webinarflow_rooms';

function readRooms() {
  const rooms = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  return Array.isArray(rooms) ? rooms : [];
}

function writeRooms(rooms) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 20);
}

function getRoomLink(roomId) {
  return `${window.location.origin}${window.location.pathname.replace(/\/[^/]*$/, '')}/room.html?id=${encodeURIComponent(roomId)}`;
}

function renderPreview(room) {
  const previewTitle = document.getElementById('previewTitle');
  const previewHost = document.getElementById('previewHost');
  const previewPin = document.getElementById('previewPin');
  const previewLink = document.getElementById('previewLink');

  if (!previewTitle || !previewHost || !previewPin || !previewLink) return;

  previewTitle.textContent = room?.title || 'هنوز هیچ جلسه‌ای ساخته نشده';
  previewHost.textContent = room?.hostName || '-';
  previewPin.textContent = room?.pin || '-';
  previewLink.textContent = room ? room.link : '-';
}

function createRoomFromForm(event) {
  event.preventDefault();

  const title = document.getElementById('meetingTitle')?.value.trim();
  const hostName = document.getElementById('hostName')?.value.trim();
  const pin = document.getElementById('pinCode')?.value.trim();
  const dateValue = document.getElementById('roomDate')?.value;
  const capacity = document.getElementById('capacity')?.value || 100;

  if (!title || !hostName || !pin || !dateValue) {
    alert('لطفاً تمام فیلدهای مورد نیاز را وارد کنید.');
    return;
  }

  const roomId = `webinar-${Math.random().toString(36).slice(2, 9)}`;
  const room = {
    id: roomId,
    title,
    hostName,
    pin,
    date: dateValue,
    capacity,
    link: `${window.location.origin}${window.location.pathname.replace(/\/[^/]*$/, '')}/room.html?id=${encodeURIComponent(roomId)}&pin=${encodeURIComponent(pin)}&role=host`,
    createdAt: new Date().toISOString()
  };

  const rooms = readRooms();
  rooms.push(room);
  writeRooms(rooms);
  renderPreview(room);

  const message = `جلسه شما با موفقیت ساخته شد.\nلینک جلسه: ${room.link}\nPIN: ${pin}`;
  alert(message);
}

function joinRoom(event) {
  event.preventDefault();

  const guestName = document.getElementById('guestName')?.value.trim();
  const roomId = document.getElementById('roomId')?.value.trim();
  const enteredPin = document.getElementById('joinPin')?.value.trim();

  if (!guestName || !roomId || !enteredPin) {
    alert('لطفاً نام، کد جلسه و PIN را وارد کنید.');
    return;
  }

  const rooms = readRooms();
  const match = rooms.find((room) => room.id === roomId || room.title === roomId || slugify(room.title) === slugify(roomId));

  if (!match) {
    alert('جلسه‌ای با این کد پیدا نشد.');
    return;
  }

  if (String(match.pin) !== String(enteredPin)) {
    alert('PIN اشتباه است. لطفاً دوباره تلاش کنید.');
    return;
  }

  const finalUrl = `${window.location.origin}${window.location.pathname.replace(/\/[^/]*$/, '')}/room.html?id=${encodeURIComponent(match.id)}&pin=${encodeURIComponent(match.pin)}&role=guest&name=${encodeURIComponent(guestName)}`;
  window.location.href = finalUrl;
}

function renderRoomPage() {
  const roomTitle = document.getElementById('roomTitle');
  const participantsSidebar = document.getElementById('participantsSidebar');
  const chatBox = document.getElementById('chatBox');
  const roomId = new URLSearchParams(window.location.search).get('id');
  const role = new URLSearchParams(window.location.search).get('role');
  const name = new URLSearchParams(window.location.search).get('name');

  if (!roomId) {
    return;
  }

  const rooms = readRooms();
  const room = rooms.find((entry) => entry.id === roomId);

  if (!room) {
    if (roomTitle) roomTitle.textContent = 'جلسه پیدا نشد';
    return;
  }

  if (roomTitle) roomTitle.textContent = room.title;

  if (participantsSidebar) {
    participantsSidebar.innerHTML = '';
    const items = [
      room.hostName,
      ...(role === 'guest' ? [name || 'مهمان'] : ['مهمان ۱', 'مهمان ۲'])
    ];

    items.forEach((person) => {
      const li = document.createElement('li');
      li.textContent = person;
      participantsSidebar.appendChild(li);
    });
  }

  if (chatBox) {
    const systemMessage = document.createElement('div');
    systemMessage.className = 'chat-message';
    systemMessage.innerHTML = `<strong>سیستم:</strong> به جلسه ${room.title} خوش آمدید.`;
    chatBox.appendChild(systemMessage);
  }
}

function addChatMessage(event) {
  event.preventDefault();
  const input = document.getElementById('chatInput');
  const chatBox = document.getElementById('chatBox');
  const value = input?.value.trim();

  if (!value || !chatBox || !input) return;

  const msg = document.createElement('div');
  msg.className = 'chat-message';
  msg.innerHTML = `<strong>شما:</strong> ${value}`;
  chatBox.appendChild(msg);
  input.value = '';
  chatBox.scrollTop = chatBox.scrollHeight;
}

function copyRoomLink() {
  const rooms = readRooms();
  const lastRoom = rooms[rooms.length - 1];
  if (!lastRoom) {
    alert('ابتدا جلسه‌ای بسازید.');
    return;
  }

  navigator.clipboard.writeText(lastRoom.link).then(() => {
    alert('لینک جلسه کپی شد.');
  });
}

function bindGlobalEvents() {
  document.getElementById('hostForm')?.addEventListener('submit', createRoomFromForm);
  document.getElementById('joinForm')?.addEventListener('submit', joinRoom);
  document.getElementById('chatForm')?.addEventListener('submit', addChatMessage);
  document.getElementById('copyLinkBtn')?.addEventListener('click', copyRoomLink);
  document.getElementById('toggleMic')?.addEventListener('click', () => {
    const button = document.getElementById('toggleMic');
    const current = button.textContent.includes('روشن');
    button.textContent = current ? 'میکروفون: خاموش' : 'میکروفون: روشن';
  });
  document.getElementById('toggleVideo')?.addEventListener('click', () => {
    const button = document.getElementById('toggleVideo');
    const current = button.textContent.includes('روشن');
    button.textContent = current ? 'ویدیو: خاموش' : 'ویدیو: روشن';
  });
  document.getElementById('leaveRoomBtn')?.addEventListener('click', () => {
    window.location.href = 'index.html';
  });
  document.getElementById('shareLinkBtn')?.addEventListener('click', async () => {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('id');
    const pin = params.get('pin');
    const role = params.get('role');
    const shareText = `${window.location.origin}${window.location.pathname}?id=${encodeURIComponent(roomId || '')}&pin=${encodeURIComponent(pin || '')}&role=${encodeURIComponent(role || 'guest')}`;
    await navigator.clipboard.writeText(shareText);
    alert('لینک جلسه کپی شد.');
  });

  const rooms = readRooms();
  if (rooms.length > 0) {
    renderPreview(rooms[rooms.length - 1]);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  bindGlobalEvents();
  renderRoomPage();
});
