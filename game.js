const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// Rozmiar canvas
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Obsługa zmiany rozmiaru okna
window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

// Dane gracza z localStorage
const playerData = JSON.parse(localStorage.getItem('playerData') || '{}');
const playerColor = playerData.color || '#FF5252';

// Połączenie WebSocket
const ws = new WebSocket("wss://agari-qfuc.onrender.com");

let myId = null;
let players = [];
const keys = {};
let mapSize = 5000;
let chatOpen = false;
let unreadMessages = 0;
let zoom = 1;

// Elementy DOM czatu
const chatPanel = document.getElementById('chatPanel');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
const chatToggle = document.getElementById('chatToggle');
const chatClose = document.getElementById('chatClose');
const unreadBadge = document.getElementById('unreadBadge');

// Eventy klawiatury
window.addEventListener("keydown", e => {
    const key = e.key.toLowerCase();
    keys[key] = true;
    
    // Otwórz/zamknij czat klawiszem T
    if (key === 't') {
        e.preventDefault();
        toggleChat();
        return;
    }
    
    // Zamknij czat klawiszem ESC
    if (key === 'escape' && chatOpen) {
        e.preventDefault();
        closeChat();
        return;
    }
    
    // Wyślij wiadomość Enter
    if (key === 'enter' && chatOpen && chatInput === document.activeElement) {
        e.preventDefault();
        sendChatMessage();
        return;
    }
});

window.addEventListener("keyup", e => {
    keys[e.key.toLowerCase()] = false;
});

// Inicjalizacja czatu
function initChat() {
    // Toggle chat panel
    chatToggle.addEventListener('click', toggleChat);
    chatClose.addEventListener('click', closeChat);
    
    // Send message
    chatSend.addEventListener('click', sendChatMessage);
    
    // Quick emojis
    document.querySelectorAll('.emoji-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            sendEmoji(this.dataset.emoji);
        });
    });
    
    // Auto-focus chat input when opened
    chatInput.addEventListener('focus', () => {
        keys.chatFocused = true;
    });
    
    chatInput.addEventListener('blur', () => {
        keys.chatFocused = false;
    });
}

// Otwórz/zamknij czat
function toggleChat() {
    chatOpen = !chatOpen;
    
    if (chatOpen) {
        chatPanel.classList.add('open');
        chatInput.focus();
        unreadMessages = 0;
        updateUnreadBadge();
        
        // Przewiń na dół czatu
        setTimeout(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }, 100);
    } else {
        chatPanel.classList.remove('open');
        chatInput.blur();
    }
}

function closeChat() {
    chatOpen = false;
    chatPanel.classList.remove('open');
    chatInput.blur();
}

// Wyślij wiadomość czatu
function sendChatMessage() {
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

// Wyślij emoji
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

// Dodaj wiadomość do czatu
function addChatMessage(data) {
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
        // Sprawdź czy to nasza wiadomość
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
    
    // Przewiń na dół
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Powiadomienie o nowej wiadomości jeśli czat zamknięty
    if (!chatOpen && data.senderId !== myId) {
        unreadMessages++;
        updateUnreadBadge();
        
        // Powiadomienie dźwiękowe (opcjonalnie)
        if (unreadMessages === 1) {
            playNotificationSound();
        }
    }
}

// Aktualizuj licznik nieprzeczytanych
function updateUnreadBadge() {
    if (unreadMessages > 0) {
        unreadBadge.textContent = unreadMessages;
        unreadBadge.style.display = 'flex';
    } else {
        unreadBadge.style.display = 'none';
    }
}

// Dźwięk powiadomienia
function playNotificationSound() {
    try {
        // Utwórz prosty dźwięk powiadomienia
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
    } catch (e) {
        console.log('Audio notifications not supported');
    }
}

// Logowanie połączenia
ws.onopen = () => {
    console.log("✅ WebSocket połączony");
    
    // Inicjalizuj czat
    initChat();
    
    // Dołącz do gry
    ws.send(JSON.stringify({
        type: "join",
        nickname: playerData.nickname || "Player"
    }));
};

ws.onerror = (e) => console.error("❌ WebSocket error", e);
ws.onclose = () => {
    console.warn("⚠️ WebSocket zamknięty");
    addChatMessage({
        type: 'chat',
        sender: 'SYSTEM',
        message: '❌ Utracono połączenie z serwerem!',
        color: '#F44336',
        timestamp: Date.now()
    });
    setTimeout(() => window.location.href = 'index.html', 3000);
};

// Odbiór wiadomości z serwera
ws.onmessage = (e) => {
    try {
        const data = JSON.parse(e.data);
        
        switch(data.type) {
            case "init":
                myId = data.id;
                mapSize = data.mapSize || 5000;
                console.log(`Zainicjowano gracza ${myId}`);
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
                    setTimeout(() => window.location.href = 'index.html', 2000);
                }
                break;
                
            case "chat":
                addChatMessage(data);
                break;
                
            case "chatHistory":
                // Wyczyść obecne wiadomości
                chatMessages.innerHTML = `
                    <div class="system-message">
                        <i class="fas fa-info-circle"></i> Historia czatu załadowana
                    </div>
                `;
                
                // Dodaj historię wiadomości
                data.messages.forEach(msg => addChatMessage(msg));
                break;
        }
    } catch (err) {
        console.error("Błąd parsowania danych:", err);
    }
};

// Aktualizacja pozycji gracza
function update() {
    if (!myId || ws.readyState !== WebSocket.OPEN) return;
    if (keys.chatFocused) return; // Nie ruszaj się podczas pisania
    
    let dx = 0, dy = 0;
    
    // Sterowanie klawiaturą
    if (keys["w"] || keys["arrowup"]) dy -= 1;
    if (keys["s"] || keys["arrowdown"]) dy += 1;
    if (keys["a"] || keys["arrowleft"]) dx -= 1;
    if (keys["d"] || keys["arrowright"]) dx += 1;
    
    // Normalizacja wektora
    if (dx !== 0 || dy !== 0) {
        const length = Math.sqrt(dx*dx + dy*dy);
        dx /= length;
        dy /= length;
        
        // Wysyłamy ruch do serwera
        ws.send(JSON.stringify({ type: "move", dx, dy }));
    }
}

// Rysowanie gry z zoomem
function draw() {
    // Tło
    ctx.fillStyle = '#f0f8ff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const me = players.find(p => p.id === myId);
    if (!me) return;
    
    // Zastosuj zoom
    ctx.save();
    const scale = 1 / zoom;
    ctx.scale(scale, scale);
    const offsetX = (canvas.width * (1 - 1/scale)) / 2;
    const offsetY = (canvas.height * (1 - 1/scale)) / 2;
    ctx.translate(offsetX, offsetY);
    
    // Siatka tła z uwzględnieniem zoomu
    drawGrid(scale);
    
    // Rysuj wszystkich graczy
    players.forEach(p => {
        // Oblicz pozycję względem naszego gracza z zoomem
        const x = (canvas.width / 2) / scale + (p.x - me.x) * zoom;
        const y = (canvas.height / 2) / scale + (p.y - me.y) * zoom;
        
        // Sprawdź czy gracz jest w widoku
        const visibleRadius = p.r * zoom;
        if (x + visibleRadius < 0 || x - visibleRadius > canvas.width / scale || 
            y + visibleRadius < 0 || y - visibleRadius > canvas.height / scale) {
            return;
        }
        
        // Rysuj kulkę z zoomem
        ctx.beginPath();
        ctx.arc(x, y, p.r * zoom, 0, Math.PI * 2);
        
        // Kolor kulki
        ctx.fillStyle = p.color || (p.id === myId ? playerColor : '#2196F3');
        ctx.fill();
        
        // Obwódka
        ctx.lineWidth = 2 * zoom;
        ctx.strokeStyle = '#000';
        ctx.stroke();
        
        // Nickname
        ctx.fillStyle = '#000';
        ctx.font = `${Math.max(12, p.r * zoom / 2)}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        
        // Skrócony nickname jeśli kulka mała
        const displayName = p.r * zoom < 30 ? p.nickname?.substr(0, 3) : p.nickname;
        ctx.fillText(displayName || "Player", x, y);
        
        // Rozmiar
        if (p.r * zoom > 25) {
            ctx.font = `${Math.max(10, p.r * zoom / 3)}px Arial`;
            ctx.fillStyle = '#333';
            ctx.fillText(`${Math.round(p.r)}`, x, y + p.r * zoom / 2 + 10);
        }
    });
    
    ctx.restore();
    
    // Rysuj minimapę
    drawMinimap(me);
}

// Rysowanie siatki tła z zoomem
function drawGrid(scale) {
    const gridSize = 50 * zoom;
    const offsetX = ((canvas.width / scale) / 2) % gridSize;
    const offsetY = ((canvas.height / scale) / 2) % gridSize;
    
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    
    // Linie pionowe
    for (let x = offsetX; x < canvas.width / scale; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height / scale);
        ctx.stroke();
    }
    
    // Linie poziome
    for (let y = offsetY; y < canvas.height / scale; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width / scale, y);
        ctx.stroke();
    }
}

// Rysowanie minimapy
function drawMinimap(me) {
    const minimapSize = 150;
    const margin = 20;
    const scale = minimapSize / mapSize;
    
    // Tło minimapy
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillRect(margin, margin, minimapSize, minimapSize);
    ctx.strokeStyle = '#000';
    ctx.strokeRect(margin, margin, minimapSize, minimapSize);
    
    // Pozycje graczy na minimapie
    players.forEach(p => {
        const x = margin + p.x * scale;
        const y = margin + p.y * scale;
        const r = Math.max(2, p.r * scale * 0.3);
        
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = p.id === myId ? playerColor : '#2196F3';
        ctx.fill();
    });
    
    // Obramowanie naszej pozycji
    const myX = margin + me.x * scale;
    const myY = margin + me.y * scale;
    ctx.beginPath();
    ctx.arc(myX, myY, Math.max(3, me.r * scale * 0.3) + 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#FF0000';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Wyświetl poziom zoomu
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(margin + minimapSize + 10, margin, 60, 25);
    ctx.fillStyle = '#fff';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Zoom: ${zoom.toFixed(1)}x`, margin + minimapSize + 40, margin + 12.5);
}

// Aktualizacja HUD
function updateHUD() {
    // Liczba graczy online
    document.getElementById('playersOnline').textContent = players.length;
    
    // Ranking (sortowanie po rozmiarze)
    const sortedPlayers = [...players].sort((a, b) => b.r - a.r);
    const myRank = sortedPlayers.findIndex(p => p.id === myId) + 1;
    document.getElementById('playerRank').textContent = myRank;
    
    // Aktualizuj kolor naszej kulki w HUD
    const me = players.find(p => p.id === myId);
    if (me) {
        document.getElementById('playerSize').textContent = Math.round(me.r);
        if (me.color) {
            document.getElementById('playerCircle').style.background = me.color;
        }
    }
}

// Obsługa scrolla do zoomu
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    
    if (e.deltaY < 0) {
        // Scroll up - zoom in
        zoom = Math.min(3, zoom + 0.1);
    } else {
        // Scroll down - zoom out
        zoom = Math.max(0.5, zoom - 0.1);
    }
});

// Główna pętla gry
function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

// Uruchom grę
gameLoop();
