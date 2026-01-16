const WebSocket = require('ws');
const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

const players = {};
const chatHistory = [];
const voiceSessions = new Map(); // Map<playerId, {targets: Set<playerId>}>
const MAX_CHAT_HISTORY = 100;
const MAP_SIZE = 5000;
const MAX_RADIUS = 100;
const INITIAL_RADIUS = 20;
const SPEED_FACTOR = 3;
const VOICE_RANGE = 200; // 20 metrów w skali gry (1 jednostka = 0.1m)

function randomPos() {
    return Math.random() * MAP_SIZE;
}

function getSpeed(radius) {
    return Math.max(1, SPEED_FACTOR * (INITIAL_RADIUS / radius));
}

// Funkcja obliczająca odległość między graczami
function getDistance(player1, player2) {
    const dx = player1.x - player2.x;
    const dy = player1.y - player2.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// Aktualizuj połączenia voice chatu na podstawie odległości
function updateVoiceConnections(playerId) {
    const player = players[playerId];
    if (!player) return;
    
    // Znajdź graczy w zasięgu voice chatu
    const nearbyPlayers = Object.values(players).filter(p => {
        if (p.id === playerId) return false;
        const distance = getDistance(player, p);
        return distance <= VOICE_RANGE;
    });
    
    // Pobierz lub stwórz sesję voice chatu
    if (!voiceSessions.has(playerId)) {
        voiceSessions.set(playerId, { targets: new Set() });
    }
    
    const session = voiceSessions.get(playerId);
    const oldTargets = new Set(session.targets);
    const newTargets = new Set(nearbyPlayers.map(p => p.id));
    
    // Dodaj nowych graczy do voice chatu
    newTargets.forEach(targetId => {
        if (!oldTargets.has(targetId)) {
            // Powiadom gracza o nowym połączeniu voice
            sendToPlayer(playerId, {
                type: 'voiceConnect',
                playerId: targetId,
                nickname: players[targetId]?.nickname || 'Unknown',
                distance: getDistance(player, players[targetId])
            });
            
            // Upewnij się, że target też ma sesję
            if (!voiceSessions.has(targetId)) {
                voiceSessions.set(targetId, { targets: new Set() });
            }
            voiceSessions.get(targetId).targets.add(playerId);
            
            session.targets.add(targetId);
        }
    });
    
    // Usuń graczy poza zasięgiem
    oldTargets.forEach(targetId => {
        if (!newTargets.has(targetId)) {
            // Powiadom gracza o rozłączeniu voice
            sendToPlayer(playerId, {
                type: 'voiceDisconnect',
                playerId: targetId
            });
            
            // Usuń z sesji targeta
            if (voiceSessions.has(targetId)) {
                voiceSessions.get(targetId).targets.delete(playerId);
            }
            
            session.targets.delete(targetId);
        }
    });
    
    // Jeśli nie ma targetów, usuń sesję
    if (session.targets.size === 0) {
        voiceSessions.delete(playerId);
    }
}

// Funkcja do wysyłania wiadomości do wszystkich graczy
function broadcast(data, excludeId = null) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            if (excludeId && players[excludeId]?.ws === client) {
                return; // Pomijamy wyłączonego gracza
            }
            client.send(message);
        }
    });
}

// Funkcja do wysyłania wiadomości do konkretnego gracza
function sendToPlayer(playerId, data) {
    const player = players[playerId];
    if (player && player.ws && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(JSON.stringify(data));
    }
}

// Rozgłaszanie audio do graczy w zasięgu
function broadcastAudio(fromPlayerId, audioData, sequence) {
    const player = players[fromPlayerId];
    if (!player) return;
    
    const session = voiceSessions.get(fromPlayerId);
    if (!session) return;
    
    // Wyślij audio do wszystkich graczy w zasięgu
    session.targets.forEach(targetId => {
        const target = players[targetId];
        if (target) {
            const distance = getDistance(player, target);
            const volume = Math.max(0.1, 1 - (distance / VOICE_RANGE)); // Obniż głośność z odległością
            
            sendToPlayer(targetId, {
                type: 'voiceAudio',
                from: fromPlayerId,
                nickname: player.nickname,
                audio: audioData,
                sequence: sequence,
                volume: volume,
                distance: distance
            });
        }
    });
}

wss.on('connection', ws => {
    let playerId = null;
    let nickname = "Player";
    
    // Zapisz referencję do WebSocket
    ws.playerId = playerId;
    
    ws.on('message', msg => {
        try {
            const data = JSON.parse(msg);
            
            if (data.type === 'join') {
                playerId = data.id || Math.random().toString(36).substr(2, 9);
                nickname = data.nickname || "Player" + playerId.substr(0, 4);
                
                players[playerId] = {
                    id: playerId,
                    nickname: nickname,
                    x: randomPos(),
                    y: randomPos(),
                    r: INITIAL_RADIUS,
                    color: '#' + Math.floor(Math.random()*16777215).toString(16),
                    ws: ws // Zapisz referencję do połączenia
                };
                
                ws.playerId = playerId;
                
                // Wyślij powitalną wiadomość na czat
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
                
                // Wyślij historię czatu do nowego gracza
                sendToPlayer(playerId, {
                    type: 'chatHistory',
                    messages: chatHistory.slice(-20)
                });
                
                // Wyślij dane inicjalizacyjne
                sendToPlayer(playerId, { 
                    type: 'init', 
                    id: playerId,
                    mapSize: MAP_SIZE,
                    voiceRange: VOICE_RANGE
                });
                
                console.log(`Player ${nickname} (${playerId}) joined`);
            }
            
            if (data.type === 'move' && playerId && players[playerId]) {
                const player = players[playerId];
                const oldX = player.x;
                const oldY = player.y;
                
                const speed = getSpeed(player.r);
                player.x += data.dx * speed;
                player.y += data.dy * speed;
                
                // Ograniczenie do mapy
                player.x = Math.max(player.r, Math.min(MAP_SIZE - player.r, player.x));
                player.y = Math.max(player.r, Math.min(MAP_SIZE - player.r, player.y));
                
                // Jeśli gracz się poruszył, zaktualizuj połączenia voice
                if (oldX !== player.x || oldY !== player.y) {
                    updateVoiceConnections(playerId);
                    
                    // Powiadom graczy o zmianie pozycji dla voice chatu
                    if (voiceSessions.has(playerId)) {
                        const session = voiceSessions.get(playerId);
                        session.targets.forEach(targetId => {
                            sendToPlayer(targetId, {
                                type: 'voicePosition',
                                playerId: playerId,
                                x: player.x,
                                y: player.y
                            });
                        });
                    }
                }
                
                // Kolizje między graczami
                Object.values(players).forEach(other => {
                    if (other.id !== playerId && other.id) {
                        const dx = player.x - other.x;
                        const dy = player.y - other.y;
                        const distance = Math.sqrt(dx*dx + dy*dy);
                        
                        if (distance < player.r + other.r) {
                            if (player.r > other.r * 1.1) {
                                // Zjedz mniejszą kulkę
                                player.r = Math.min(MAX_RADIUS, player.r + other.r * 0.5);
                                
                                // Wiadomość o zjedzeniu
                                const eatMessage = {
                                    type: 'chat',
                                    sender: 'SYSTEM',
                                    message: `🍽️ ${player.nickname} zjadł ${other.nickname}!`,
                                    color: '#FF5252',
                                    timestamp: Date.now()
                                };
                                
                                chatHistory.push(eatMessage);
                                if (chatHistory.length > MAX_CHAT_HISTORY) {
                                    chatHistory.shift();
                                }
                                
                                broadcast(eatMessage);
                                
                                // Zamknij połączenia voice dla zjedzonego gracza
                                if (voiceSessions.has(other.id)) {
                                    voiceSessions.get(other.id).targets.forEach(targetId => {
                                        sendToPlayer(targetId, {
                                            type: 'voiceDisconnect',
                                            playerId: other.id
                                        });
                                    });
                                    voiceSessions.delete(other.id);
                                }
                                
                                delete players[other.id];
                                
                                broadcast({
                                    type: 'eat',
                                    eater: playerId,
                                    eaten: other.id
                                });
                            }
                        }
                    }
                });
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
                    
                    console.log(`[CHAT] ${player.nickname}: ${message}`);
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
                // Przekaż audio do graczy w zasięgu
                broadcastAudio(playerId, data.audio, data.sequence);
            }
            
            if (data.type === 'voiceStatus' && playerId && players[playerId]) {
                const player = players[playerId];
                
                // Rozgłoś status voice chatu do graczy w zasięgu
                if (voiceSessions.has(playerId)) {
                    const session = voiceSessions.get(playerId);
                    session.targets.forEach(targetId => {
                        sendToPlayer(targetId, {
                            type: 'voiceStatusUpdate',
                            playerId: playerId,
                            nickname: player.nickname,
                            status: data.status, // 'talking', 'silent'
                            timestamp: Date.now()
                        });
                    });
                }
            }
            
        } catch (err) {
            console.error('Error processing message:', err);
        }
    });
    
    ws.on('close', () => {
        if (playerId && players[playerId]) {
            const playerName = players[playerId].nickname;
            
            // Zamknij połączenia voice chatu
            if (voiceSessions.has(playerId)) {
                voiceSessions.get(playerId).targets.forEach(targetId => {
                    sendToPlayer(targetId, {
                        type: 'voiceDisconnect',
                        playerId: playerId
                    });
                });
                voiceSessions.delete(playerId);
            }
            
            // Wiadomość pożegnalna
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
            
            console.log(`Player ${playerName} (${playerId}) disconnected`);
            delete players[playerId];
        }
    });
    
    ws.on('error', (err) => {
        console.error('WebSocket error:', err);
    });
});

// Wysyłanie stanu gry do wszystkich graczy
setInterval(() => {
    const snapshot = JSON.stringify({ 
        type: 'state', 
        players: Object.values(players),
        timestamp: Date.now()
    });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(snapshot);
        }
    });
}, 50);

console.log(`✅ Server started on port ${PORT} (Voice Chat enabled)`);
