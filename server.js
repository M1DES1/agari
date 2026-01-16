const WebSocket = require('ws');
const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

const players = {};
const foods = [];
const viruses = [];
const bullets = [];
const chatHistory = [];
const voiceConnections = new Map();
const MAX_CHAT_HISTORY = 100;
const MAP_SIZE = 5000;
const MAX_RADIUS = 500;
const INITIAL_RADIUS = 20;
const SPEED_FACTOR = 3;
const VOICE_RANGE = 200;
const FOOD_COUNT = 1000;
const VIRUS_COUNT = 20;
const BULLET_LIFETIME = 30000;
const SPLIT_COOLDOWN = 10000;
const VIRUS_SPLIT_COUNT = 10;

// Inicjalizacja jedzenia
function initFood() {
    foods.length = 0;
    for (let i = 0; i < FOOD_COUNT; i++) {
        foods.push({
            id: `food_${Date.now()}_${i}`,
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
            id: `virus_${Date.now()}_${i}`,
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

function randomPos() {
    return Math.random() * MAP_SIZE;
}

function getSpeed(radius) {
    return Math.max(0.5, SPEED_FACTOR * (INITIAL_RADIUS / radius));
}

function getDistance(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
}

function spawnFood(count = 1) {
    for (let i = 0; i < count; i++) {
        foods.push({
            id: `food_${Date.now()}_${Math.random()}`,
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
        id: `virus_${Date.now()}`,
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
    viruses.forEach(virus => {
        // Zmień cel co 3-5 sekund
        if (now - virus.lastUpdate > 3000 + Math.random() * 2000) {
            virus.targetX = Math.random() * MAP_SIZE;
            virus.targetY = Math.random() * MAP_SIZE;
            virus.lastUpdate = now;
        }
        
        // Uciekaj przed graczami
        let nearestPlayer = null;
        let nearestDist = Infinity;
        
        Object.values(players).forEach(player => {
            const dist = getDistance(virus.x, virus.y, player.x, player.y);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestPlayer = player;
            }
        });
        
        if (nearestPlayer && nearestDist < 300) {
            // Uciekaj od gracza
            const angle = Math.atan2(virus.y - nearestPlayer.y, virus.x - nearestPlayer.x);
            virus.x += Math.cos(angle) * virus.speed;
            virus.y += Math.sin(angle) * virus.speed;
        } else {
            // Ruch w stronę celu
            const angle = Math.atan2(virus.targetY - virus.y, virus.targetX - virus.x);
            virus.x += Math.cos(angle) * virus.speed * 0.5;
            virus.y += Math.sin(angle) * virus.speed * 0.5;
        }
        
        // Ograniczenia mapy
        virus.x = Math.max(virus.r, Math.min(MAP_SIZE - virus.r, virus.x));
        virus.y = Math.max(virus.r, Math.min(MAP_SIZE - virus.r, virus.y));
    });
}

function updateBullets() {
    const now = Date.now();
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        
        // Sprawdź czy kula wygasła
        if (now - bullet.createdAt > BULLET_LIFETIME) {
            bullets.splice(i, 1);
            
            // Jeśli kula wygasła, dodaj część masy z powrotem do gracza
            if (players[bullet.ownerId]) {
                players[bullet.ownerId].r += bullet.r * 0.5;
            }
            continue;
        }
        
        // Ruch w stronę właściciela
        const owner = players[bullet.ownerId];
        if (owner) {
            const dx = owner.x - bullet.x;
            const dy = owner.y - bullet.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < 10) {
                // Połączenie z właścicielem
                owner.r += bullet.r * 0.8;
                bullets.splice(i, 1);
                
                // Powiadom gracza
                sendToPlayer(bullet.ownerId, {
                    type: 'bulletReturn',
                    mass: Math.round(bullet.r * 0.8)
                });
            } else {
                // Ruch w stronę właściciela
                const speed = 5;
                bullet.x += (dx / dist) * speed;
                bullet.y += (dy / dist) * speed;
            }
        } else {
            // Jeśli właściciel nie istnieje, usuń kulę
            bullets.splice(i, 1);
        }
    }
}

function checkCollisions(playerId) {
    const player = players[playerId];
    if (!player) return;
    
    // Kolizja z jedzeniem
    for (let i = foods.length - 1; i >= 0; i--) {
        const food = foods[i];
        const dist = getDistance(player.x, player.y, food.x, food.y);
        
        if (dist < player.r) {
            // Zjedz jedzenie
            player.r += food.r * 0.5;
            foods.splice(i, 1);
            
            // Respawnuj nowe jedzenie
            spawnFood(1);
            
            sendToPlayer(playerId, {
                type: 'eatFood',
                mass: Math.round(food.r * 0.5)
            });
        }
    }
    
    // Kolizja z wirusami
    for (let i = viruses.length - 1; i >= 0; i--) {
        const virus = viruses[i];
        const dist = getDistance(player.x, player.y, virus.x, virus.y);
        
        if (dist < player.r + virus.r) {
            if (player.r > virus.r * 1.1) {
                // Zjedz wirusa
                player.r += virus.r;
                viruses.splice(i, 1);
                
                // Stwórz 10 małych kulek z wirusa
                for (let j = 0; j < VIRUS_SPLIT_COUNT; j++) {
                    foods.push({
                        id: `food_virus_${Date.now()}_${j}`,
                        x: player.x + (Math.random() - 0.5) * 200,
                        y: player.y + (Math.random() - 0.5) * 200,
                        r: 3,
                        color: '#00FF00',
                        type: 'virus'
                    });
                }
                
                // Respawnuj nowego wirusa
                setTimeout(() => spawnVirus(), 5000);
                
                sendToPlayer(playerId, {
                    type: 'eatVirus',
                    mass: Math.round(virus.r)
                });
            } else if (virus.r > player.r * 1.1) {
                // Virus zjada gracza
                sendToPlayer(playerId, {
                    type: 'eaten',
                    by: 'Virus'
                });
                
                // Usuń gracza
                const playerName = player.nickname;
                delete players[playerId];
                
                broadcast({
                    type: 'chat',
                    sender: 'SYSTEM',
                    message: `💀 ${playerName} został zjedzony przez wirusa!`,
                    color: '#FF0000',
                    timestamp: Date.now()
                });
                
                return;
            }
        }
    }
    
    // Kolizja z innymi graczami
    Object.keys(players).forEach(otherId => {
        if (otherId === playerId) return;
        
        const other = players[otherId];
        const dist = getDistance(player.x, player.y, other.x, other.y);
        
        if (dist < player.r + other.r) {
            if (player.r > other.r * 1.1) {
                // Zjedz innego gracza
                player.r += other.r * 0.7;
                
                // Powiadom obu graczy
                sendToPlayer(playerId, {
                    type: 'eatPlayer',
                    playerId: otherId,
                    mass: Math.round(other.r * 0.7)
                });
                
                sendToPlayer(otherId, {
                    type: 'eaten',
                    by: player.nickname
                });
                
                // Usuń zjedzonego gracza
                const otherName = other.nickname;
                delete players[otherId];
                
                broadcast({
                    type: 'chat',
                    sender: 'SYSTEM',
                    message: `🍽️ ${player.nickname} zjadł ${otherName}!`,
                    color: '#FF9800',
                    timestamp: Date.now()
                });
                
            } else if (other.r > player.r * 1.1) {
                // Inny gracz może zjeść tego gracza
                sendToPlayer(playerId, {
                    type: 'eaten',
                    by: other.nickname
                });
            }
        }
    });
    
    // Kolizja z pociskami
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        if (bullet.ownerId === playerId) continue;
        
        const dist = getDistance(player.x, player.y, bullet.x, bullet.y);
        
        if (dist < player.r + bullet.r) {
            if (player.r > bullet.r * 1.1) {
                // Zjedz pocisk
                player.r += bullet.r * 0.6;
                bullets.splice(i, 1);
                
                sendToPlayer(playerId, {
                    type: 'eatBullet',
                    mass: Math.round(bullet.r * 0.6)
                });
            }
        }
    }
}

function updateVoiceConnections(playerId) {
    const player = players[playerId];
    if (!player) return;
    
    const nearbyPlayers = Object.values(players).filter(p => {
        if (p.id === playerId) return false;
        const distance = getDistance(player.x, player.y, p.x, p.y);
        return distance <= VOICE_RANGE;
    });
    
    const nearbyPlayerIds = new Set(nearbyPlayers.map(p => p.id));
    const currentConnections = voiceConnections.get(playerId) || new Set();
    
    // Dodaj nowe połączenia
    nearbyPlayerIds.forEach(targetId => {
        if (!currentConnections.has(targetId)) {
            sendToPlayer(playerId, {
                type: 'voiceConnect',
                playerId: targetId,
                nickname: players[targetId]?.nickname,
                distance: getDistance(player.x, player.y, players[targetId].x, players[targetId].y)
            });
            
            sendToPlayer(targetId, {
                type: 'voiceConnect',
                playerId: playerId,
                nickname: player.nickname,
                distance: getDistance(players[targetId].x, players[targetId].y, player.x, player.y)
            });
            
            if (!voiceConnections.has(targetId)) {
                voiceConnections.set(targetId, new Set());
            }
            voiceConnections.get(targetId).add(playerId);
            currentConnections.add(targetId);
        }
    });
    
    // Usuń rozłączone połączenia
    const toRemove = [];
    currentConnections.forEach(targetId => {
        if (!nearbyPlayerIds.has(targetId)) {
            toRemove.push(targetId);
            
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
    
    toRemove.forEach(targetId => {
        currentConnections.delete(targetId);
    });
    
    if (currentConnections.size > 0) {
        voiceConnections.set(playerId, currentConnections);
    } else {
        voiceConnections.delete(playerId);
    }
}

function broadcast(data, excludeId = null) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            if (excludeId && players[excludeId]?.ws === client) {
                return;
            }
            client.send(message);
        }
    });
}

function sendToPlayer(playerId, data) {
    const player = players[playerId];
    if (player && player.ws && player.ws.readyState === WebSocket.OPEN) {
        try {
            player.ws.send(JSON.stringify(data));
        } catch (err) {
            console.error('❌ Error sending to player:', err);
        }
    }
}

function broadcastAudio(fromPlayerId, audioData, sequence) {
    const player = players[fromPlayerId];
    if (!player) return;
    
    const connections = voiceConnections.get(fromPlayerId);
    if (!connections) return;
    
    connections.forEach(targetId => {
        const target = players[targetId];
        if (target) {
            const distance = getDistance(player.x, player.y, target.x, target.y);
            const volume = Math.max(0.1, 1 - (distance / VOICE_RANGE));
            
            sendToPlayer(targetId, {
                type: 'voiceAudio',
                from: fromPlayerId,
                nickname: player.nickname,
                audio: audioData,
                sequence: sequence,
                volume: volume,
                distance: Math.round(distance),
                timestamp: Date.now()
            });
        }
    });
}

wss.on('connection', ws => {
    let playerId = null;
    let nickname = "Player";
    
    console.log('🔌 New WebSocket connection');
    
    ws.on('message', async (msg) => {
        try {
            let data;
            
            if (typeof msg === 'string') {
                data = JSON.parse(msg);
            } else if (Buffer.isBuffer(msg)) {
                data = JSON.parse(msg.toString());
            } else {
                console.error('Unknown message type:', typeof msg);
                return;
            }
            
            if (data.type === 'join') {
                playerId = data.id || Math.random().toString(36).substr(2, 9);
                nickname = data.nickname || "Player" + playerId.substr(0, 4);
                
                players[playerId] = {
                    id: playerId,
                    nickname: nickname,
                    x: randomPos(),
                    y: randomPos(),
                    r: INITIAL_RADIUS,
                    color: data.color || '#' + Math.floor(Math.random()*16777215).toString(16),
                    ws: ws,
                    isSpeaking: false,
                    imageUrl: data.imageUrl || null,
                    lastSplit: 0,
                    mass: INITIAL_RADIUS
                };
                
                ws.playerId = playerId;
                
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
                    foods: foods.slice(0, 200),
                    viruses: viruses,
                    players: Object.values(players).map(p => ({
                        id: p.id,
                        nickname: p.nickname,
                        x: p.x,
                        y: p.y,
                        r: p.r,
                        color: p.color,
                        imageUrl: p.imageUrl
                    }))
                });
                
                sendToPlayer(playerId, {
                    type: 'chatHistory',
                    messages: chatHistory.slice(-20)
                });
                
                console.log(`🎮 Player ${nickname} (${playerId}) joined, total: ${Object.keys(players).length}`);
            }
            
            if (data.type === 'move' && playerId && players[playerId]) {
                const player = players[playerId];
                const oldX = player.x;
                const oldY = player.y;
                
                const speed = getSpeed(player.r);
                player.x += data.dx * speed;
                player.y += data.dy * speed;
                
                player.x = Math.max(player.r, Math.min(MAP_SIZE - player.r, player.x));
                player.y = Math.max(player.r, Math.min(MAP_SIZE - player.r, player.y));
                
                if (oldX !== player.x || oldY !== player.y) {
                    updateVoiceConnections(playerId);
                    checkCollisions(playerId);
                }
            }
            
            if (data.type === 'shoot' && playerId && players[playerId]) {
                const player = players[playerId];
                const now = Date.now();
                
                // Sprawdź cooldown
                if (now - player.lastSplit < SPLIT_COOLDOWN) {
                    sendToPlayer(playerId, {
                        type: 'cooldown',
                        remaining: Math.ceil((SPLIT_COOLDOWN - (now - player.lastSplit)) / 1000)
                    });
                    return;
                }
                
                // Minimalny rozmiar do strzelania
                if (player.r < 40) {
                    sendToPlayer(playerId, {
                        type: 'error',
                        message: 'Musisz mieć co najmniej 40 rozmiaru aby strzelać!'
                    });
                    return;
                }
                
                // Utwórz pocisk (10% masy gracza)
                const bulletMass = player.r * 0.1;
                player.r -= bulletMass;
                player.lastSplit = now;
                
                const angle = Math.atan2(data.mouseY - data.playerY, data.mouseX - data.playerX);
                const bullet = {
                    id: `bullet_${playerId}_${Date.now()}`,
                    x: player.x + Math.cos(angle) * (player.r + 10),
                    y: player.y + Math.sin(angle) * (player.r + 10),
                    r: bulletMass,
                    color: player.color,
                    ownerId: playerId,
                    angle: angle,
                    speed: 8,
                    createdAt: now
                };
                
                bullets.push(bullet);
                
                sendToPlayer(playerId, {
                    type: 'bulletFired',
                    mass: Math.round(bulletMass)
                });
                
                console.log(`💥 ${player.nickname} wystrzelił kulkę (${Math.round(bulletMass)} masy)`);
            }
            
            if (data.type === 'chat' && playerId && players[playerId]) {
                const player = players[playerId];
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
                    
                    console.log(`💬 [CHAT] ${player.nickname}: ${message}`);
                }
            }
            
            if (data.type === 'emoji' && playerId && players[playerId]) {
                const player = players[playerId];
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
            
            if (data.type === 'voiceAudio' && playerId && players[playerId]) {
                const audioSize = data.audio?.length || 0;
                
                if (data.audio && audioSize > 10) {
                    broadcastAudio(playerId, data.audio, data.sequence || 0);
                }
            }
            
            if (data.type === 'voiceStatus' && playerId && players[playerId]) {
                const player = players[playerId];
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
                    timestamp: Date.now()
                });
            }
            
        } catch (err) {
            console.error('❌ Error processing message:', err);
        }
    });
    
    ws.on('close', () => {
        console.log(`🔌 WebSocket closed for ${playerId}`);
        
        if (playerId && players[playerId]) {
            const playerName = players[playerId].nickname;
            
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
                voiceConnections.delete(playerId);
            }
            
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
            
            console.log(`🎮 Player ${playerName} (${playerId}) disconnected`);
            delete players[playerId];
        }
    });
    
    ws.on('error', (err) => {
        console.error('❌ WebSocket error:', err);
    });
});

// Główna pętla gry
setInterval(() => {
    // Aktualizuj wirusy
    updateViruses();
    
    // Aktualizuj pociski
    updateBullets();
    
    // Sprawdzaj kolizje dla wszystkich graczy
    Object.keys(players).forEach(playerId => {
        checkCollisions(playerId);
    });
    
    // Przygotuj dane do wysłania
    const gameState = {
        type: 'gameState',
        players: Object.values(players).map(p => ({
            id: p.id,
            nickname: p.nickname,
            x: p.x,
            y: p.y,
            r: p.r,
            color: p.color,
            imageUrl: p.imageUrl,
            isSpeaking: p.isSpeaking || false
        })),
        foods: foods.slice(0, 300),
        viruses: viruses,
        bullets: bullets,
        timestamp: Date.now()
    };
    
    const message = JSON.stringify(gameState);
    
    // Wyślij do wszystkich klientów
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
            } catch (err) {
                console.error('❌ Error sending game state:', err);
            }
        }
    });
}, 50);

// Respawn jedzenia
setInterval(() => {
    if (foods.length < FOOD_COUNT * 0.8) {
        const toSpawn = Math.min(50, FOOD_COUNT - foods.length);
        spawnFood(toSpawn);
        console.log(`🍎 Respawned ${toSpawn} food`);
    }
}, 5000);

// Respawn wirusów
setInterval(() => {
    if (viruses.length < VIRUS_COUNT * 0.8) {
        const toSpawn = Math.min(5, VIRUS_COUNT - viruses.length);
        for (let i = 0; i < toSpawn; i++) {
            spawnVirus();
        }
        console.log(`🦠 Respawned ${toSpawn} viruses`);
    }
}, 10000);

console.log(`✅ Server started on port ${PORT}`);
console.log(`🎮 Game features: Food (${FOOD_COUNT}), Viruses (${VIRUS_COUNT}), Shooting, Voice Chat`);
console.log(`🎤 Voice Chat enabled with ${VOICE_RANGE/10}m range`);
