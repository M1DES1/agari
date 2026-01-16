const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

const playerData = JSON.parse(localStorage.getItem('playerData') || '{}');
const playerColor = playerData.color || '#FF5252';

const ws = new WebSocket("wss://agari-qfuc.onrender.com");

let myId = null;
let players = [];
const keys = {};
let mapSize = 5000;
let chatOpen = false;
let unreadMessages = 0;
let zoom = 1;
let voiceRange = 200;

let isVoiceActive = false;
let voiceStream = null;
let mediaRecorder = null;
let audioContext = null;
let audioElements = new Map();
let voiceConnections = new Set();
let voiceSequence = 0;

let chatPanel, chatMessages, chatInput, chatSend, chatToggle, chatClose, unreadBadge;
let voiceToggle, voiceStatus, voiceIndicator, voiceUsersList;

function initDOM() {
    chatPanel = document.getElementById('chatPanel');
    chatMessages = document.getElementById('chatMessages');
    chatInput = document.getElementById('chatInput');
    chatSend = document.getElementById('chatSend');
    chatToggle = document.getElementById('chatToggle');
    chatClose = document.getElementById('chatClose');
    unreadBadge = document.getElementById('unreadBadge');
    
    voiceToggle = document.getElementById('voiceToggle');
    voiceStatus = document.getElementById('voiceStatus');
    voiceIndicator = document.getElementById('voiceIndicator');
    voiceUsersList = document.getElementById('voiceUsersList');
    
    const playerNameElement = document.getElementById('playerName');
    const playerCircleElement = document.getElementById('playerCircle');
    
    if (playerNameElement && playerData.nickname) {
        playerNameElement.textContent = playerData.nickname;
    }
    
    if (playerCircleElement) {
        playerCircleElement.style.background = playerColor;
    }
    
    const menuBtn = document.getElementById('menuBtn');
    if (menuBtn) {
        menuBtn.addEventListener('click', () => {
            if (confirm('Czy na pewno chcesz wrócić do menu? Stracisz obecną grę.')) {
                stopVoiceChat();
                window.location.href = 'index.html';
            }
        });
    }
    
    if (voiceToggle) {
        voiceToggle.addEventListener('click', toggleVoiceChat);
    }
    
    if (!playerData.nickname) {
        window.location.href = 'index.html';
    }
}

function initChat() {
    if (!chatToggle || !chatClose || !chatSend) return;
    
    chatToggle.addEventListener('click', toggleChat);
    chatClose.addEventListener('click', closeChat);
    chatSend.addEventListener('click', sendChatMessage);
    
    document.querySelectorAll('.emoji-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            sendEmoji(this.dataset.emoji);
        });
    });
    
    if (chatInput) {
        chatInput.addEventListener('focus', () => {
            keys.chatFocused = true;
        });
        
        chatInput.addEventListener('blur', () => {
            keys.chatFocused = false;
        });
    }
}

async function initVoiceChat() {
    try {
        if (!playerData.allowVoice) {
            updateVoiceStatus('disabled');
            return;
        }
        
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            updateVoiceStatus('unavailable');
            return;
        }
        
        voiceStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        console.log('Microphone access granted');
        updateVoiceStatus('ready');
        
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
    } catch (error) {
        console.error('Error accessing microphone:', error);
        updateVoiceStatus('denied');
        
        addChatMessage({
            type: 'chat',
            sender: 'SYSTEM',
            message: '❌ Voice chat niedostępny. Sprawdź uprawnienia mikrofonu.',
            color: '#F44336',
            timestamp: Date.now()
        });
    }
}

async function toggleVoiceChat() {
    if (!voiceStream) {
        await initVoiceChat();
        return;
    }
    
    if (isVoiceActive) {
        stopVoiceChat();
    } else {
        startVoiceChat();
    }
}

function startVoiceChat() {
    if (!voiceStream || isVoiceActive) return;
    
    try {
        mediaRecorder = new MediaRecorder(voiceStream);
        
        let audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
                
                const blob = new Blob(audioChunks, { type: 'audio/webm; codecs=opus' });
                const reader = new FileReader();
                
                reader.onloadend = () => {
                    const base64Audio = reader.result.split(',')[1];
                    
                    if (ws.readyState === WebSocket.OPEN && myId) {
                        ws.send(JSON.stringify({
                            type: 'voiceAudio',
                            audio: base64Audio,
                            sequence: voiceSequence++
                        }));
                    }
                };
                
                reader.readAsDataURL(blob);
                audioChunks = [];
            }
        };
        
        mediaRecorder.start(100);
        isVoiceActive = true;
        
        sendVoiceStatus('talking');
        updateVoiceStatus('active');
        
        if (voiceToggle) {
            voiceToggle.classList.add('active');
        }
        
    } catch (error) {
        console.error('Error starting voice chat:', error);
        updateVoiceStatus('error');
    }
}

function stopVoiceChat() {
    if (mediaRecorder && isVoiceActive) {
        mediaRecorder.stop();
        isVoiceActive = false;
        
        sendVoiceStatus('silent');
        updateVoiceStatus('ready');
        
        if (voiceToggle) {
            voiceToggle.classList.remove('active');
        }
    }
}

function sendVoiceStatus(status) {
    if (ws.readyState === WebSocket.OPEN && myId) {
        ws.send(JSON.stringify({
            type: 'voiceStatus',
            status: status
        }));
    }
}

function updateVoiceStatus(status) {
    if (!voiceStatus || !voiceIndicator) return;
    
    switch(status) {
        case 'disabled':
            voiceStatus.textContent = 'Voice: Wył.';
            voiceIndicator.style.background = '#9E9E9E';
            break;
        case 'unavailable':
            voiceStatus.textContent = 'Voice: Niedostępny';
            voiceIndicator.style.background = '#9E9E9E';
            break;
        case 'denied':
            voiceStatus.textContent = 'Voice: Brak dostępu';
            voiceIndicator.style.background = '#F44336';
            break;
        case 'ready':
            voiceStatus.textContent = 'Voice: Gotowy';
            voiceIndicator.style.background = '#4CAF50';
            break;
        case 'active':
            voiceStatus.textContent = 'Voice: Aktywny 🎤';
            voiceIndicator.style.background = '#FF9800';
            break;
        case 'error':
            voiceStatus.textContent = 'Voice: Błąd';
            voiceIndicator.style.background = '#F44336';
            break;
    }
}

function playVoiceAudio(fromPlayerId, audioData, volume = 1.0) {
    if (!audioContext || audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    let audioElement = audioElements.get(fromPlayerId);
    
    if (!audioElement) {
        audioElement = new Audio();
        audioElement.autoplay = true;
        audioElements.set(fromPlayerId, audioElement);
    }
    
    audioElement.volume = Math.max(0.1, Math.min(1.0, volume));
    audioElement.src = `data:audio/webm;base64,${audioData}`;
    
    showVoiceActivity(fromPlayerId, true);
    
    audioElement.onended = () => {
        showVoiceActivity(fromPlayerId, false);
    };
}

function showVoiceActivity(playerId, isSpeaking) {
    const player = players.find(p => p.id === playerId);
    if (player) {
        player.isSpeaking = isSpeaking;
        updateVoiceUsersList();
    }
}

function updateVoiceUsersList() {
    if (!voiceUsersList) return;
    
    voiceUsersList.innerHTML = '';
    
    const me = players.find(p => p.id === myId);
    if (me) {
        const myItem = document.createElement('div');
        myItem.className = `voice-user ${isVoiceActive ? 'speaking' : ''}`;
        myItem.innerHTML = `
            <div class="voice-user-indicator"></div>
            <span class="voice-user-name">${me.nickname} (Ty)</span>
            ${isVoiceActive ? '<span class="voice-mic-icon">🎤</span>' : ''}
        `;
        voiceUsersList.appendChild(myItem);
    }
    
    voiceConnections.forEach(playerId => {
        const player = players.find(p => p.id === playerId);
        if (player) {
            const userItem = document.createElement('div');
            userItem.className = `voice-user ${player.isSpeaking ? 'speaking' : ''}`;
            userItem.innerHTML = `
                <div class="voice-user-indicator"></div>
                <span class="voice-user-name">${player.nickname}</span>
                ${player.isSpeaking ? '<span class="voice-mic-icon">🔊</span>' : ''}
            `;
            voiceUsersList.appendChild(userItem);
        }
    });
}

function handleVoiceConnect(playerId, nickname, distance) {
    voiceConnections.add(playerId);
    
    addChatMessage({
        type: 'chat',
        sender: 'SYSTEM',
        message: `🔊 ${nickname} jest w zasięgu voice chatu (${Math.round(distance/10)}m)`,
        color: '#2196F3',
        timestamp: Date.now()
    });
    
    updateVoiceUsersList();
    
    const voiceCountElement = document.getElementById('voiceCount');
    if (voiceCountElement) {
        voiceCountElement.textContent = voiceConnections.size;
    }
}

function handleVoiceDisconnect(playerId) {
    const player = players.find(p => p.id === playerId);
    if (player) {
        addChatMessage({
            type: 'chat',
            sender: 'SYSTEM',
            message: `🔇 ${player.nickname} wyszedł poza zasięg`,
            color: '#FF9800',
            timestamp: Date.now()
        });
    }
    
    voiceConnections.delete(playerId);
    
    const audioElement = audioElements.get(playerId);
    if (audioElement) {
        audioElement.pause();
        audioElements.delete(playerId);
    }
    
    updateVoiceUsersList();
    
    const voiceCountElement = document.getElementById('voiceCount');
    if (voiceCountElement) {
        voiceCountElement.textContent = voiceConnections.size;
    }
}

function toggleChat() {
    if (!chatPanel) return;
    
    chatOpen = !chatOpen;
    
    if (chatOpen) {
        chatPanel.classList.add('open');
        if (chatInput) {
            chatInput.focus();
        }
        unreadMessages = 0;
        updateUnreadBadge();
        
        setTimeout(() => {
            if (chatMessages) {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        }, 100);
    } else {
        chatPanel.classList.remove('open');
        if (chatInput) {
            chatInput.blur();
        }
    }
}

function closeChat() {
    if (!chatPanel) return;
    
    chatOpen = false;
    chatPanel.classList.remove('open');
    if (chatInput) {
        chatInput.blur();
    }
}

function sendChatMessage() {
    if (!chatInput) return;
    
    const message = chatInput.value.trim();
    
    if (message && ws.readyState === WebSocket.OPEN && myId) {
        ws.send(JSON.stringify({
            type: 'chat',
            message: message
        }));
        
        chatInput.value = '';
        chatInput.focus();
    }
}

function sendEmoji(emoji) {
    if (ws.readyState === WebSocket.OPEN && myId) {
        ws.send(JSON.stringify({
            type: 'emoji',
            emoji: emoji
        }));
    }
    
    if (!chatOpen) {
        toggleChat();
    }
}

function addChatMessage(data) {
    if (!chatMessages) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';
    
    const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    if (data.sender === 'SYSTEM') {
        messageDiv.classList.add('system');
        messageDiv.innerHTML = `
            <div class="message-content system">
                <i class="fas fa-bullhorn"></i>
                <span>${data.message}</span>
                <span class="message-time">${time}</span>
            </div>
        `;
    } else if (data.isEmoji) {
        messageDiv.classList.add('emoji');
        messageDiv.innerHTML = `
            <div class="message-header">
                <span class="sender-name" style="color: ${data.color}">
                    ${data.sender}
                </span>
            </div>
            <div class="message-content emoji-content">
                <span class="emoji-large">${data.message}</span>
                <span class="message-time">${time}</span>
            </div>
        `;
    } else {
        const isMyMessage = data.senderId === myId;
        messageDiv.classList.add(isMyMessage ? 'my-message' : 'other-message');
        
        messageDiv.innerHTML = `
            <div class="message-header">
                <div class="sender-avatar" style="background: ${data.color}"></div>
                <span class="sender-name" style="color: ${data.color}">
                    ${data.sender}
                </span>
            </div>
            <div class="message-content">
                <span>${data.message}</span>
                <span class="message-time">${time}</span>
            </div>
        `;
    }
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    if (!chatOpen && data.senderId !== myId) {
        unreadMessages++;
        updateUnreadBadge();
    }
}

function updateUnreadBadge() {
    if (!unreadBadge) return;
    
    if (unreadMessages > 0) {
        unreadBadge.textContent = unreadMessages;
        unreadBadge.style.display = 'flex';
    } else {
        unreadBadge.style.display = 'none';
    }
}

window.addEventListener("keydown", e => {
    const key = e.key.toLowerCase();
    keys[key] = true;
    
    if (key === 'v' && voiceStream && !isVoiceActive) {
        e.preventDefault();
        startVoiceChat();
        return;
    }
    
    if (key === 't') {
        e.preventDefault();
        toggleChat();
        return;
    }
    
    if (key === 'escape' && chatOpen) {
        e.preventDefault();
        closeChat();
        return;
    }
    
    if (key === 'enter' && chatOpen && chatInput && chatInput === document.activeElement) {
        e.preventDefault();
        sendChatMessage();
        return;
    }
});

window.addEventListener("keyup", e => {
    const key = e.key.toLowerCase();
    keys[key] = false;
    
    if (key === 'v' && isVoiceActive) {
        e.preventDefault();
        stopVoiceChat();
    }
});

ws.onopen = () => {
    console.log("✅ WebSocket połączony");
    
    initDOM();
    initChat();
    initVoiceChat();
    
    ws.send(JSON.stringify({
        type: "join",
        nickname: playerData.nickname || "Player"
    }));
};

ws.onerror = (e) => console.error("❌ WebSocket error", e);

ws.onclose = () => {
    console.warn("⚠️ WebSocket zamknięty");
    stopVoiceChat();
    addChatMessage({
        type: 'chat',
        sender: 'SYSTEM',
        message: '❌ Utracono połączenie z serwerem!',
        color: '#F44336',
        timestamp: Date.now()
    });
    setTimeout(() => window.location.href = 'index.html', 3000);
};

ws.onmessage = (e) => {
    try {
        const data = JSON.parse(e.data);
        
        switch(data.type) {
            case "init":
                myId = data.id;
                mapSize = data.mapSize || 5000;
                voiceRange = data.voiceRange || 200;
                const voiceRangeInfo = document.getElementById('voiceRangeInfo');
                if (voiceRangeInfo) {
                    voiceRangeInfo.textContent = '20m';
                }
                break;
                
            case "state":
                players = data.players;
                updateHUD();
                break;
                
            case "eat":
                if (data.eaten === myId) {
                    addChatMessage({
                        type: 'chat',
                        sender: 'SYSTEM',
                        message: '💀 Zostałeś zjedzony! Wracasz do menu...',
                        color: '#F44336',
                        timestamp: Date.now()
                    });
                    stopVoiceChat();
                    setTimeout(() => window.location.href = 'index.html', 2000);
                }
                break;
                
            case "chat":
                addChatMessage(data);
                break;
                
            case "chatHistory":
                if (chatMessages) {
                    chatMessages.innerHTML = `
                        <div class="system-message">
                            <i class="fas fa-info-circle"></i> Historia czatu załadowana
                        </div>
                    `;
                    data.messages.forEach(msg => addChatMessage(msg));
                }
                break;
                
            case "voiceConnect":
                handleVoiceConnect(data.playerId, data.nickname, data.distance);
                break;
                
            case "voiceDisconnect":
                handleVoiceDisconnect(data.playerId);
                break;
                
            case "voiceAudio":
                playVoiceAudio(data.from, data.audio, data.volume);
                break;
                
            case "voicePosition":
                const player = players.find(p => p.id === data.playerId);
                if (player) {
                    player.x = data.x;
                    player.y = data.y;
                }
                break;
                
            case "voiceStatusUpdate":
                showVoiceActivity(data.playerId, data.status === 'talking');
                break;
        }
    } catch (err) {
        console.error("Błąd parsowania danych:", err);
    }
};

function update() {
    if (!myId || ws.readyState !== WebSocket.OPEN) return;
    if (keys.chatFocused) return;
    
    let dx = 0, dy = 0;
    
    if (keys["w"] || keys["arrowup"]) dy -= 1;
    if (keys["s"] || keys["arrowdown"]) dy += 1;
    if (keys["a"] || keys["arrowleft"]) dx -= 1;
    if (keys["d"] || keys["arrowright"]) dx += 1;
    
    if (dx !== 0 || dy !== 0) {
        const length = Math.sqrt(dx*dx + dy*dy);
        dx /= length;
        dy /= length;
        
        ws.send(JSON.stringify({ type: "move", dx, dy }));
    }
}

function draw() {
    ctx.fillStyle = '#f0f8ff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const me = players.find(p => p.id === myId);
    if (!me) return;
    
    ctx.save();
    const scale = 1 / zoom;
    ctx.scale(scale, scale);
    const offsetX = (canvas.width * (1 - 1/scale)) / 2;
    const offsetY = (canvas.height * (1 - 1/scale)) / 2;
    ctx.translate(offsetX, offsetY);
    
    drawGrid(scale);
    
    players.forEach(p => {
        const x = (canvas.width / 2) / scale + (p.x - me.x) * zoom;
        const y = (canvas.height / 2) / scale + (p.y - me.y) * zoom;
        
        const visibleRadius = p.r * zoom;
        if (x + visibleRadius < 0 || x - visibleRadius > canvas.width / scale || 
            y + visibleRadius < 0 || y - visibleRadius > canvas.height / scale) {
            return;
        }
        
        ctx.beginPath();
        ctx.arc(x, y, p.r * zoom, 0, Math.PI * 2);
        
        ctx.fillStyle = p.color || (p.id === myId ? playerColor : '#2196F3');
        ctx.fill();
        
        ctx.lineWidth = 2 * zoom;
        ctx.strokeStyle = '#000';
        ctx.stroke();
        
        ctx.fillStyle = '#000';
        ctx.font = `${Math.max(12, p.r * zoom / 2)}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        
        const displayName = p.r * zoom < 30 ? p.nickname?.substr(0, 3) : p.nickname;
        ctx.fillText(displayName || "Player", x, y);
        
        if (p.r * zoom > 25) {
            ctx.font = `${Math.max(10, p.r * zoom / 3)}px Arial`;
            ctx.fillStyle = '#333';
            ctx.fillText(`${Math.round(p.r)}`, x, y + p.r * zoom / 2 + 10);
        }
        
        if (p.isSpeaking) {
            const pulse = (Math.sin(Date.now() / 200) + 1) * 0.3;
            ctx.beginPath();
            ctx.arc(x, y, p.r * zoom + 10 + pulse * 5, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 152, 0, ${0.5 + pulse * 0.3})`;
            ctx.lineWidth = 3;
            ctx.stroke();
        }
    });
    
    ctx.restore();
    
    drawMinimap(me);
    drawVoiceRange(me);
}

function drawGrid(scale) {
    const gridSize = 50 * zoom;
    const offsetX = ((canvas.width / scale) / 2) % gridSize;
    const offsetY = ((canvas.height / scale) / 2) % gridSize;
    
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    
    for (let x = offsetX; x < canvas.width / scale; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height / scale);
        ctx.stroke();
    }
    
    for (let y = offsetY; y < canvas.height / scale; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width / scale, y);
        ctx.stroke();
    }
}

function drawMinimap(me) {
    const minimapSize = 150;
    const margin = 20;
    const scale = minimapSize / mapSize;
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillRect(margin, margin, minimapSize, minimapSize);
    ctx.strokeStyle = '#000';
    ctx.strokeRect(margin, margin, minimapSize, minimapSize);
    
    players.forEach(p => {
        const x = margin + p.x * scale;
        const y = margin + p.y * scale;
        const r = Math.max(2, p.r * scale * 0.3);
        
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = p.id === myId ? playerColor : '#2196F3';
        ctx.fill();
    });
    
    const myX = margin + me.x * scale;
    const myY = margin + me.y * scale;
    ctx.beginPath();
    ctx.arc(myX, myY, Math.max(3, me.r * scale * 0.3) + 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#FF0000';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawVoiceRange(me) {
    ctx.beginPath();
    ctx.arc(canvas.width/2, canvas.height/2, voiceRange * zoom, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(33, 150, 243, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(33, 150, 243, 0.1)';
    ctx.fill();
}

function updateHUD() {
    const playersOnlineElement = document.getElementById('playersOnline');
    if (playersOnlineElement) {
        playersOnlineElement.textContent = players.length;
    }
    
    const sortedPlayers = [...players].sort((a, b) => b.r - a.r);
    const myRank = sortedPlayers.findIndex(p => p.id === myId) + 1;
    const playerRankElement = document.getElementById('playerRank');
    if (playerRankElement) {
        playerRankElement.textContent = myRank;
    }
    
    const playerSizeElement = document.getElementById('playerSize');
    const me = players.find(p => p.id === myId);
    if (me && playerSizeElement) {
        playerSizeElement.textContent = Math.round(me.r);
    }
}

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    
    if (e.deltaY < 0) {
        zoom = Math.min(3, zoom + 0.1);
    } else {
        zoom = Math.max(0.5, zoom - 0.1);
    }
});

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

window.addEventListener('DOMContentLoaded', () => {
    initDOM();
    gameLoop();
});

window.addEventListener('beforeunload', () => {
    stopVoiceChat();
});
