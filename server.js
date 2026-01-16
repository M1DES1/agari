const WebSocket = require('ws');
const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ 
    port: PORT,
    perMessageDeflate: false // Wyłącz kompresję dla mniejszego opóźnienia
});

const players = new Map(); // Używamy Map zamiast obiektu dla lepszej wydajności
const foods = [];
const viruses = [];
const bullets = [];
const chatHistory = [];
const voiceConnections = new Map();
const MAX_CHAT_HISTORY = 100;
const MAP_SIZE = 5000;
const INITIAL_RADIUS = 20;
const BASE_SPEED = 4.5; // Zwiększona prędkość bazowa
const VOICE_RANGE = 200;
const FOOD_COUNT = 800; // Zmniejszona ilość jedzenia dla lepszej wydajności
const VIRUS_COUNT = 15;
const BULLET_LIFETIME = 30000;
const SPLIT_COOLDOWN = 10000;
const VIRUS_SPLIT_COUNT = 10;
const TICK_RATE = 30; // 30 FPS na serwerze
const MAX_PLAYER_SPEED = 10;
const MIN_PLAYER_SPEED = 0.5;

// Buffery dla optymalizacji
const playerUpdateBuffer = new Map();
const lastUpdateTimes = new Map();

// Inicjalizacja jedzenia
function initFood() {
    foods.length = 0;
    for (let i = 0; i < FOOD_COUNT; i++) {
        foods.push({
            id: i,
            x: Math.random() * MAP_SIZE,
            y: Math.random() * MAP_SIZE,
            r: 5 + Math.random() * 5,
            color: `hsl(${Math.random() * 360}, 70%, 60%)`,
            type: 'normal'
        });
    }
}

// Inicjalizacja wirusów
function initViruses() {
    viruses.length = 0;
    for (let i = 0; i < VIRUS_COUNT; i++) {
        viruses.push({
            id: i,
            x: Math.random() * MAP_SIZE,
            y: Math.random() * MAP_SIZE,
            r: 30 + Math.random() * 20,
            color: '#00FF00',
            speed: 1.5,
            targetX: Math.random() * MAP_SIZE,
            targetY: Math.random() * MAP_SIZE,
            lastUpdate: Date.now(),
            type: 'virus'
        });
    }
}

initFood();
initViruses();

function getSpeed(radius) {
    // Optymalizacja: pre-calc i clamping
    const speed = Math.max(MIN_PLAYER_SPEED, Math.min(MAX_PLAYER_SPEED, BASE_SPEED * (INITIAL_RADIUS / radius)));
    return speed;
}

function getDistance(x1, y1, x2, y2) {
    // Szybkie obliczanie odległości bez pierwiastka dla porównań
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy; // Zwraca kwadrat odległości
}

function getDistanceSqrt(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
}

function spawnFood(count = 1) {
    for (let i = 0; i < count; i++) {
        foods.push({
            id: Date.now() + Math.random(),
            x: Math.random() * MAP_SIZE,
            y: Math.random() * MAP_SIZE,
            r: 5 + Math.random() * 5,
            color: `hsl(${Math.random() * 360}, 70%, 60%)`,
            type: 'normal'
        });
    }
}

function spawnVirus() {
    viruses.push({
        id: Date.now(),
        x: Math.random() * MAP_SIZE,
        y: Math.random() * MAP_SIZE,
        r: 30 + Math.random() * 20,
        color: '#00FF00',
        speed: 1.5,
        targetX: Math.random() * MAP_SIZE,
        targetY: Math.random() * MAP_SIZE,
        lastUpdate: Date.now(),
        type: 'virus'
    });
}

function updateViruses() {
    const now = Date.now();
    const virusUpdateInterval = 100; // Aktualizuj wirusy co 100ms
    
    viruses.forEach(virus => {
        if (now - virus.lastUpdate > virusUpdateInterval) {
            // Uciekaj przed najbliższym graczem
            let nearestPlayer = null;
            let nearestDistSq = Infinity;
            
            players.forEach(player => {
                const distSq = getDistance(virus.x, virus.y, player.x, player.y);
                if (distSq < nearestDistSq) {
                    nearestDistSq = distSq;
                    nearestPlayer = player;
                }
            });
            
            if (nearestPlayer && nearestDistSq < 90000) { // 300^2
                // Uciekaj od gracza
                const angle = Math.atan2(virus.y - nearestPlayer.y, virus.x - nearestPlayer.x);
                virus.x += Math.cos(angle) * virus.speed;
                virus.y += Math.sin(angle) * virus.speed;
            } else {
                // Losowy ruch
                const angle = Math.random() * Math.PI * 2;
                virus.x += Math.cos(angle) * virus.speed * 0.3;
                virus.y += Math.sin(angle) * virus.speed * 0.3;
            }
            
            // Ograniczenia mapy
            virus.x = Math.max(virus.r, Math.min(MAP_SIZE - virus.r, virus.x));
            virus.y = Math.max(virus.r, Math.min(MAP_SIZE - virus.r, virus.y));
            
            virus.lastUpdate = now;
        }
    });
}

function updateBullets() {
    const now = Date.now();
    
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        
        // Sprawdź czy kula wygasła
        if (now - bullet.createdAt > BULLET_LIFETIME) {
            bullets.splice(i, 1);
            continue;
        }
        
        // Ruch w stronę właściciela
        const owner = players.get(bullet.ownerId);
        if (owner) {
            const dx = owner.x - bullet.x;
            const dy = owner.y - bullet.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < 15) { // Zwiększony radius połączenia
                // Połączenie z właścicielem
                owner.r += bullet.r * 0.8;
                bullets.splice(i, 1);
                
                // Buforuj powiadomienie
                if (playerUpdateBuffer.has(bullet.ownerId)) {
                    playerUpdateBuffer.get(bullet.ownerId).push({
                        type: 'bulletReturn',
                        mass: Math.round(bullet.r * 0.8)
                    });
                }
            } else {
                // Szybszy ruch kuli
                const speed = 8;
                bullet.x += (dx / dist) * speed;
                bullet.y += (dy / dist) * speed;
            }
        }
    }
}

function checkCollisions(playerId) {
    const player = players.get(playerId);
    if (!player) return;
    
    // OPTYMALIZACJA: Używamy kwadratów odległości dla szybkości
    const playerRadiusSq = player.r * player.r;
    
    // Kolizja z jedzeniem - batch processing
    const foodCheckCount = Math.min(50, foods.length); // Sprawdzaj tylko najbliższe jedzenie
    for (let i = foods.length - 1; i >= Math.max(0, foods.length - foodCheckCount); i--) {
        const food = foods[i];
        const distSq = getDistance(player.x, player.y, food.x, food.y);
        const collisionDist = player.r + food.r;
        
        if (distSq < collisionDist * collisionDist) {
            player.r += food.r * 0.5;
            foods.splice(i, 1);
            
            // Buforuj powiadomienie
            if (playerUpdateBuffer.has(playerId)) {
                playerUpdateBuffer.get(playerId).push({
                    type: 'eatFood',
                    mass: Math.round(food.r * 0.5)
                });
            }
            
            spawnFood(1);
            break; // Zjedz tylko jedno jedzenie na tick
        }
    }
    
    // Kolizja z wirusami
    viruses.forEach((virus, i) => {
        const distSq = getDistance(player.x, player.y, virus.x, virus.y);
        const collisionDist = player.r + virus.r;
        
        if (distSq < collisionDist * collisionDist) {
            if (player.r > virus.r * 1.1) {
                player.r += virus.r;
                viruses.splice(i, 1);
                
                // Stwórz małe kulki
                for (let j = 0; j < VIRUS_SPLIT_COUNT; j++) {
                    foods.push({
                        id: Date.now() + j,
                        x: player.x + (Math.random() - 0.5) * 200,
                        y: player.y + (Math.random() - 0.5) * 200,
                        r: 3,
                        color: '#00FF00',
                        type: 'virus'
                    });
                }
                
                setTimeout(() => spawnVirus(), 3000);
                
                if (playerUpdateBuffer.has(playerId)) {
                    playerUpdateBuffer.get(playerId).push({
                        type: 'eatVirus',
                        mass: Math.round(virus.r)
                    });
                }
            } else if (virus.r > player.r * 1.1) {
                // Virus zjada gracza
                broadcastPlayerEaten(playerId, 'Virus');
                return;
            }
        }
    });
    
    // Kolizja z innymi graczami
    players.forEach((other, otherId) => {
        if (otherId === playerId) return;
        
        const distSq = getDistance(player.x, player.y, other.x, other.y);
        const collisionDist = player.r + other.r;
        
        if (distSq < collisionDist * collisionDist) {
            if (player.r > other.r * 1.1) {
                player.r += other.r * 0.7;
                
                // Powiadomienia
                if (playerUpdateBuffer.has(playerId)) {
                    playerUpdateBuffer.get(playerId).push({
                        type: 'eatPlayer',
                        playerId: otherId,
                        mass: Math.round(other.r * 0.7)
                    });
                }
                
                if (playerUpdateBuffer.has(otherId)) {
                    playerUpdateBuffer.get(otherId).push({
                        type: 'eaten',
                        by: player.nickname
                    });
                }
                
                broadcastPlayerEaten(otherId, player.nickname);
            }
        }
    });
}

function broadcastPlayerEaten(playerId, by) {
    const player = players.get(playerId);
    if (!player) return;
    
    broadcast({
        type: 'chat',
        sender: 'SYSTEM',
        message: `🍽️ ${by} zjadł ${player.nickname}!`,
        color: '#FF9800',
        timestamp: Date.now()
    });
    
    players.delete(playerId);
    voiceConnections.delete(playerId);
    playerUpdateBuffer.delete(playerId);
    lastUpdateTimes.delete(playerId);
}

function updateVoiceConnections(playerId) {
    const player = players.get(playerId);
    if (!player) return;
    
    const connections = voiceConnections.get(playerId) || new Set();
    const newConnections = new Set();
    
    // Sprawdź tylko raz na sekundę (nie co tick)
    const now = Date.now();
    const lastVoiceUpdate = lastUpdateTimes.get(`voice_${playerId}`) || 0;
    
    if (now - lastVoiceUpdate < 1000) return;
    lastUpdateTimes.set(`voice_${playerId}`, now);
    
    players.forEach((other, otherId) => {
        if (otherId === playerId) return;
        
        const distanceSq = getDistance(player.x, player.y, other.x, other.y);
        
        if (distanceSq <= VOICE_RANGE * VOICE_RANGE) {
            newConnections.add(otherId);
            
            if (!connections.has(otherId)) {
                // Nowe połączenie
                sendToPlayer(playerId, {
                    type: 'voiceConnect',
                    playerId: otherId,
                    nickname: other.nickname,
                    distance: Math.sqrt(distanceSq)
                });
                
                sendToPlayer(otherId, {
                    type: 'voiceConnect',
                    playerId: playerId,
                    nickname: player.nickname,
                    distance: Math.sqrt(distanceSq)
                });
                
                if (!voiceConnections.has(otherId)) {
                    voiceConnections.set(otherId, new Set());
                }
                voiceConnections.get(otherId).add(playerId);
            }
        }
    });
    
    // Usuń rozłączone połączenia
    connections.forEach(targetId => {
        if (!newConnections.has(targetId)) {
            sendToPlayer(playerId, {
                type: 'voiceDisconnect',
                playerId: targetId
            });
            
            sendToPlayer(targetId, {
                type: 'voiceDisconnect',
                playerId: playerId
            });
            
            if (voiceConnections.has(targetId)) {
                voiceConnections.get(targetId).delete(playerId);
                if (voiceConnections.get(targetId).size === 0) {
                    voiceConnections.delete(targetId);
                }
            }
        }
    });
    
    if (newConnections.size > 0) {
        voiceConnections.set(playerId, newConnections);
    } else {
        voiceConnections.delete(playerId);
    }
}

// Optymalizacja: Batch updates
function broadcast(data, excludeId = null) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            if (excludeId && players.get(excludeId)?.ws === client) {
                return;
            }
            try {
                client.send(message);
            } catch (err) {
                console.error('Send error:', err);
            }
        }
    });
}

function sendToPlayer(playerId, data) {
    const player = players.get(playerId);
    if (player && player.ws && player.ws.readyState === WebSocket.OPEN) {
        try {
            // Buforuj wiadomości dla gracza
            if (!playerUpdateBuffer.has(playerId)) {
                playerUpdateBuffer.set(playerId, []);
            }
            playerUpdateBuffer.get(playerId).push(data);
        } catch (err) {
            console.error('Send to player error:', err);
        }
    }
}

function flushPlayerBuffers() {
    playerUpdateBuffer.forEach((messages, playerId) => {
        const player = players.get(playerId);
        if (player && player.ws && player.ws.readyState === WebSocket.OPEN && messages.length > 0) {
            try {
                // Wyślij wszystkie zbuforowane wiadomości naraz
                messages.forEach(message => {
                    player.ws.send(JSON.stringify(message));
                });
                playerUpdateBuffer.set(playerId, []);
            } catch (err) {
                console.error('Flush buffer error:', err);
                playerUpdateBuffer.delete(playerId);
            }
        }
    });
}

wss.on('connection', ws => {
    let playerId = null;
    let nickname = "Player";
    let lastPing = Date.now();
    
    console.log('🔌 New WebSocket connection');
    
    // Ustaw timeout na nieaktywne połączenia
    const connectionTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, 'Connection timeout');
        }
    }, 30000);
    
    ws.on('pong', () => {
        lastPing = Date.now();
    });
    
    ws.on('message', async (msg) => {
        try {
            let data;
            
            if (typeof msg === 'string') {
                data = JSON.parse(msg);
            } else if (Buffer.isBuffer(msg)) {
                data = JSON.parse(msg.toString());
            } else {
                return;
            }
            
            if (data.type === 'join') {
                playerId = data.id || Math.random().toString(36).substr(2, 9);
                nickname = data.nickname || "Player" + playerId.substr(0, 4);
                
                players.set(playerId, {
                    id: playerId,
                    nickname: nickname,
                    x: Math.random() * MAP_SIZE,
                    y: Math.random() * MAP_SIZE,
                    r: INITIAL_RADIUS,
                    color: data.color || '#' + Math.floor(Math.random()*16777215).toString(16),
                    ws: ws,
                    isSpeaking: false,
                    imageUrl: data.imageUrl || null,
                    lastSplit: 0,
                    mass: INITIAL_RADIUS,
                    lastMove: Date.now(),
                    moveBuffer: []
                });
                
                ws.playerId = playerId;
                
                // Inicjalizuj bufor dla gracza
                playerUpdateBuffer.set(playerId, []);
                
                const welcomeMessage = {
                    type: 'chat',
                    sender: 'SYSTEM',
                    message: `👋 Gracz ${nickname} dołączył do gry!`,
                    color: '#4CAF50',
                    timestamp: Date.now()
                };
                
                chatHistory.push(welcomeMessage);
                if (chatHistory.length > MAX_CHAT_HISTORY) {
                    chatHistory.shift();
                }
                
                broadcast(welcomeMessage);
                
                // Wyślij początkowy stan
                sendToPlayer(playerId, {
                    type: 'init',
                    id: playerId,
                    mapSize: MAP_SIZE,
                    voiceRange: VOICE_RANGE,
                    foods: foods.slice(0, 150), // Mniej jedzenia na start
                    viruses: viruses.slice(0, 10),
                    players: Array.from(players.values()).map(p => ({
                        id: p.id,
                        nickname: p.nickname,
                        x: p.x,
                        y: p.y,
                        r: p.r,
                        color: p.color,
                        imageUrl: p.imageUrl
                    })),
                    serverTime: Date.now()
                });
                
                sendToPlayer(playerId, {
                    type: 'chatHistory',
                    messages: chatHistory.slice(-20)
                });
                
                console.log(`🎮 Player ${nickname} (${playerId}) joined, total: ${players.size}`);
            }
            
            if (data.type === 'move' && playerId && players.has(playerId)) {
                const player = players.get(playerId);
                const now = Date.now();
                
                // Client-side prediction correction
                if (data.clientTime && Math.abs(now - data.clientTime) > 100) {
                    // Synchronizuj czas
                    sendToPlayer(playerId, {
                        type: 'timeSync',
                        serverTime: now,
                        clientTime: data.clientTime
                    });
                }
                
                // Buforuj ruchy i aplikuj je w ticku gry
                if (!player.moveBuffer) player.moveBuffer = [];
                player.moveBuffer.push({
                    dx: data.dx,
                    dy: data.dy,
                    timestamp: now
                });
                
                // Ogranicz bufor ruchów
                if (player.moveBuffer.length > 10) {
                    player.moveBuffer = player.moveBuffer.slice(-5);
                }
                
                player.lastMove = now;
            }
            
            if (data.type === 'shoot' && playerId && players.has(playerId)) {
                const player = players.get(playerId);
                const now = Date.now();
                
                if (now - player.lastSplit < SPLIT_COOLDOWN) {
                    sendToPlayer(playerId, {
                        type: 'cooldown',
                        remaining: Math.ceil((SPLIT_COOLDOWN - (now - player.lastSplit)) / 1000)
                    });
                    return;
                }
                
                if (player.r < 40) {
                    sendToPlayer(playerId, {
                        type: 'error',
                        message: 'Musisz mieć co najmniej 40 rozmiaru aby strzelać!'
                    });
                    return;
                }
                
                const bulletMass = player.r * 0.1;
                player.r -= bulletMass;
                player.lastSplit = now;
                
                const angle = Math.atan2(data.mouseY - data.playerY, data.mouseX - data.playerX);
                const bullet = {
                    id: `bullet_${playerId}_${Date.now()}`,
                    x: player.x + Math.cos(angle) * (player.r + 15),
                    y: player.y + Math.sin(angle) * (player.r + 15),
                    r: bulletMass,
                    color: player.color,
                    ownerId: playerId,
                    angle: angle,
                    speed: 10,
                    createdAt: now
                };
                
                bullets.push(bullet);
                
                sendToPlayer(playerId, {
                    type: 'bulletFired',
                    mass: Math.round(bulletMass),
                    serverTime: now
                });
            }
            
            if (data.type === 'chat' && playerId && players.has(playerId)) {
                const player = players.get(playerId);
                const message = data.message?.trim();
                
                if (message && message.length > 0 && message.length <= 200) {
                    const chatMessage = {
                        type: 'chat',
                        sender: player.nickname,
                        message: message,
                        color: player.color,
                        senderId: playerId,
                        timestamp: Date.now()
                    };
                    
                    chatHistory.push(chatMessage);
                    if (chatHistory.length > MAX_CHAT_HISTORY) {
                        chatHistory.shift();
                    }
                    
                    broadcast(chatMessage);
                }
            }
            
            if (data.type === 'emoji' && playerId && players.has(playerId)) {
                const player = players.get(playerId);
                const emojiMessage = {
                    type: 'chat',
                    sender: player.nickname,
                    message: data.emoji,
                    color: player.color,
                    isEmoji: true,
                    timestamp: Date.now()
                };
                
                chatHistory.push(emojiMessage);
                if (chatHistory.length > MAX_CHAT_HISTORY) {
                    chatHistory.shift();
                }
                
                broadcast(emojiMessage);
            }
            
            if (data.type === 'voiceAudio' && playerId && players.has(playerId)) {
                const audioSize = data.audio?.length || 0;
                
                if (data.audio && audioSize > 10 && audioSize < 50000) {
                    const player = players.get(playerId);
                    const connections = voiceConnections.get(playerId);
                    
                    if (connections) {
                        const voiceData = {
                            type: 'voiceAudio',
                            from: playerId,
                            nickname: player.nickname,
                            audio: data.audio,
                            sequence: data.sequence || 0,
                            timestamp: Date.now()
                        };
                        
                        connections.forEach(targetId => {
                            const target = players.get(targetId);
                            if (target) {
                                const distance = getDistanceSqrt(player.x, player.y, target.x, target.y);
                                const volume = Math.max(0.1, 1 - (distance / VOICE_RANGE));
                                
                                sendToPlayer(targetId, {
                                    ...voiceData,
                                    volume: volume,
                                    distance: Math.round(distance)
                                });
                            }
                        });
                    }
                }
            }
            
            if (data.type === 'voiceStatus' && playerId && players.has(playerId)) {
                const player = players.get(playerId);
                player.isSpeaking = data.status === 'talking';
                
                const connections = voiceConnections.get(playerId);
                if (connections) {
                    connections.forEach(targetId => {
                        sendToPlayer(targetId, {
                            type: 'voiceStatusUpdate',
                            playerId: playerId,
                            nickname: player.nickname,
                            status: data.status,
                            timestamp: Date.now()
                        });
                    });
                }
            }
            
            if (data.type === 'ping') {
                sendToPlayer(playerId, {
                    type: 'pong',
                    timestamp: Date.now(),
                    serverTime: Date.now()
                });
            }
            
        } catch (err) {
            console.error('❌ Error processing message:', err);
        }
    });
    
    ws.on('close', () => {
        clearTimeout(connectionTimeout);
        
        if (playerId && players.has(playerId)) {
            const player = players.get(playerId);
            const playerName = player.nickname;
            
            // Powiadom o rozłączeniu
            const goodbyeMessage = {
                type: 'chat',
                sender: 'SYSTEM',
                message: `🚪 Gracz ${playerName} opuścił grę`,
                color: '#FF9800',
                timestamp: Date.now()
            };
            
            chatHistory.push(goodbyeMessage);
            if (chatHistory.length > MAX_CHAT_HISTORY) {
                chatHistory.shift();
            }
            
            broadcast(goodbyeMessage, playerId);
            
            // Wyczyść wszystkie połączenia głosowe
            const connections = voiceConnections.get(playerId);
            if (connections) {
                connections.forEach(targetId => {
                    sendToPlayer(targetId, {
                        type: 'voiceDisconnect',
                        playerId: playerId
                    });
                    
                    if (voiceConnections.has(targetId)) {
                        voiceConnections.get(targetId).delete(playerId);
                        if (voiceConnections.get(targetId).size === 0) {
                            voiceConnections.delete(targetId);
                        }
                    }
                });
            }
            
            // Usuń gracza
            players.delete(playerId);
            voiceConnections.delete(playerId);
            playerUpdateBuffer.delete(playerId);
            lastUpdateTimes.delete(playerId);
            
            console.log(`🎮 Player ${playerName} (${playerId}) disconnected`);
        }
    });
    
    ws.on('error', (err) => {
        console.error('❌ WebSocket error:', err);
        clearTimeout(connectionTimeout);
    });
    
    // Ping-pong dla utrzymania połączenia
    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.ping();
            } catch (err) {
                clearInterval(pingInterval);
            }
        } else {
            clearInterval(pingInterval);
        }
    }, 15000);
});

// Główna pętla gry - ZWIĘKSZONA CZĘSTOTLIWOŚĆ
const TICK_INTERVAL = 1000 / TICK_RATE;
let lastTick = Date.now();

function gameTick() {
    const now = Date.now();
    const deltaTime = Math.min(100, now - lastTick) / 1000; // Ogranicz delta time
    
    // Aktualizuj pozycje graczy z bufora ruchów
    players.forEach((player, playerId) => {
        if (player.moveBuffer && player.moveBuffer.length > 0) {
            // Uśrednij ruchy z bufora
            let totalDx = 0;
            let totalDy = 0;
            let validMoves = 0;
            
            player.moveBuffer.forEach(move => {
                if (now - move.timestamp < 200) { // Używaj tylko świeżych ruchów
                    totalDx += move.dx;
                    totalDy += move.dy;
                    validMoves++;
                }
            });
            
            if (validMoves > 0) {
                const avgDx = totalDx / validMoves;
                const avgDy = totalDy / validMoves;
                
                const speed = getSpeed(player.r);
                const moveX = avgDx * speed * deltaTime * 60; // Skalowanie do FPS
                const moveY = avgDy * speed * deltaTime * 60;
                
                if (Math.abs(moveX) > 0.1 || Math.abs(moveY) > 0.1) {
                    player.x += moveX;
                    player.y += moveY;
                    
                    // Ograniczenia mapy
                    player.x = Math.max(player.r, Math.min(MAP_SIZE - player.r, player.x));
                    player.y = Math.max(player.r, Math.min(MAP_SIZE - player.r, player.y));
                    
                    // Sprawdź kolizje
                    checkCollisions(playerId);
                    
                    // Aktualizuj voice connections (rzadziej)
                    if (now % 3 === 0) { // Co 3 ticki
                        updateVoiceConnections(playerId);
                    }
                }
            }
            
            // Oczyść stary bufor
            player.moveBuffer = player.moveBuffer.filter(move => now - move.timestamp < 200);
        }
    });
    
    // Aktualizuj wirusy (rzadziej)
    if (now % 2 === 0) {
        updateViruses();
    }
    
    // Aktualizuj pociski
    updateBullets();
    
    // Przygotuj dane do wysłania (tylko niezbędne informacje)
    const gameState = {
        type: 'gameState',
        players: Array.from(players.values()).map(p => ({
            id: p.id,
            x: Math.round(p.x * 10) / 10, // Zaokrąglenie dla mniejszego payload
            y: Math.round(p.y * 10) / 10,
            r: Math.round(p.r),
            color: p.color,
            isSpeaking: p.isSpeaking || false
        })),
        foods: foods.slice(0, 200).map(f => ({
            x: Math.round(f.x),
            y: Math.round(f.y),
            r: Math.round(f.r),
            color: f.color,
            type: f.type
        })),
        viruses: viruses.slice(0, 15).map(v => ({
            x: Math.round(v.x),
            y: Math.round(v.y),
            r: Math.round(v.r)
        })),
        bullets: bullets.map(b => ({
            x: Math.round(b.x),
            y: Math.round(b.y),
            r: Math.round(b.r),
            color: b.color,
            ownerId: b.ownerId
        })),
        timestamp: now,
        tick: Math.floor(now / TICK_INTERVAL)
    };
    
    // Kompresuj stan gry
    const compressedState = JSON.stringify(gameState);
    
    // Wyślij do wszystkich klientów
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(compressedState);
            } catch (err) {
                // Ignoruj błędy wysyłania
            }
        }
    });
    
    // Wyślij zbuforowane wiadomości
    flushPlayerBuffers();
    
    lastTick = now;
}

// Uruchom pętlę gry z fixed timestep
setInterval(gameTick, TICK_INTERVAL);

// Respawn jedzenia
setInterval(() => {
    if (foods.length < FOOD_COUNT * 0.7) {
        const toSpawn = Math.min(30, FOOD_COUNT - foods.length);
        spawnFood(toSpawn);
    }
}, 3000);

// Respawn wirusów
setInterval(() => {
    if (viruses.length < VIRUS_COUNT * 0.8) {
        const toSpawn = Math.min(3, VIRUS_COUNT - viruses.length);
        for (let i = 0; i < toSpawn; i++) {
            spawnVirus();
        }
    }
}, 8000);

// Czyszczenie nieaktywnych graczy
setInterval(() => {
    const now = Date.now();
    players.forEach((player, playerId) => {
        if (now - player.lastMove > 30000) { // 30 sekund bez ruchu
            players.delete(playerId);
            voiceConnections.delete(playerId);
            playerUpdateBuffer.delete(playerId);
            console.log(`🕒 Player ${player.nickname} kicked for inactivity`);
        }
    });
}, 10000);

console.log(`✅ Server started on port ${PORT} (${TICK_RATE} FPS)`);
console.log(`🎮 Game optimized for low latency`);
console.log(`📊 Expected players: ${Math.floor(1000000 / (players.size * 100))}`); // Przybliżona pojemność
