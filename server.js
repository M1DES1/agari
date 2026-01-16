const WebSocket = require('ws');
const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

const players = {};
const chatHistory = [];
const voiceConnections = new Map();
const MAX_CHAT_HISTORY = 100;
const MAP_SIZE = 5000;
const MAX_RADIUS = 100;
const INITIAL_RADIUS = 20;
const SPEED_FACTOR = 3;
const VOICE_RANGE = 200;

function randomPos() {
    return Math.random() * MAP_SIZE;
}

function getSpeed(radius) {
    return Math.max(1, SPEED_FACTOR * (INITIAL_RADIUS / radius));
}

function getDistance(player1, player2) {
    const dx = player1.x - player2.x;
    const dy = player1.y - player2.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function updateVoiceConnections(playerId) {
    const player = players[playerId];
    if (!player) return;
    
    const nearbyPlayers = Object.values(players).filter(p => {
        if (p.id === playerId) return false;
        const distance = getDistance(player, p);
        return distance <= VOICE_RANGE;
    });
    
    const nearbyPlayerIds = new Set(nearbyPlayers.map(p => p.id));
    const currentConnections = voiceConnections.get(playerId) || new Set();
    
    // Dodaj nowe połączenia
    nearbyPlayerIds.forEach(targetId => {
        if (!currentConnections.has(targetId)) {
            console.log(`🔊 Voice CONNECT: ${player.nickname} -> ${players[targetId]?.nickname}`);
            
            sendToPlayer(playerId, {
                type: 'voiceConnect',
                playerId: targetId,
                nickname: players[targetId]?.nickname,
                distance: getDistance(player, players[targetId])
            });
            
            sendToPlayer(targetId, {
                type: 'voiceConnect',
                playerId: playerId,
                nickname: player.nickname,
                distance: getDistance(players[targetId], player)
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
            console.log(`🔊 Voice DISCONNECT: ${player.nickname} -> ${players[targetId]?.nickname}`);
            
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
    
    console.log(`🔊 Voice AUDIO from ${player.nickname} to ${connections.size} players`);
    
    connections.forEach(targetId => {
        const target = players[targetId];
        if (target) {
            const distance = getDistance(player, target);
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
                    color: '#' + Math.floor(Math.random()*16777215).toString(16),
                    ws: ws,
                    isSpeaking: false
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
                
                sendToPlayer(playerId, {
                    type: 'chatHistory',
                    messages: chatHistory.slice(-20)
                });
                
                sendToPlayer(playerId, { 
                    type: 'init', 
                    id: playerId,
                    mapSize: MAP_SIZE,
                    voiceRange: VOICE_RANGE
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
                }
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
                console.log(`🎤 Voice audio received from ${playerId}, size: ${audioSize} bytes`);
                
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

setInterval(() => {
    const playersArray = Object.values(players).map(p => ({
        id: p.id,
        nickname: p.nickname,
        x: p.x,
        y: p.y,
        r: p.r,
        color: p.color,
        isSpeaking: p.isSpeaking || false
    }));
    
    const snapshot = JSON.stringify({ 
        type: 'state', 
        players: playersArray,
        timestamp: Date.now()
    });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(snapshot);
            } catch (err) {
                console.error('❌ Error sending snapshot:', err);
            }
        }
    });
}, 50);

setInterval(() => {
    Object.keys(players).forEach(playerId => {
        updateVoiceConnections(playerId);
    });
}, 1000);

console.log(`✅ Server started on port ${PORT}`);
console.log(`🎤 Voice Chat enabled with ${VOICE_RANGE/10}m range`);
