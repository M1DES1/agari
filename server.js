const WebSocket = require('ws');
const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

const players = {};
const chatHistory = [];
const MAX_CHAT_HISTORY = 100;
const MAP_SIZE = 5000;
const MAX_RADIUS = 100;
const INITIAL_RADIUS = 20;
const SPEED_FACTOR = 3;

function randomPos() {
    return Math.random() * MAP_SIZE;
}

function getSpeed(radius) {
    return Math.max(1, SPEED_FACTOR * (INITIAL_RADIUS / radius));
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
                    messages: chatHistory.slice(-20) // Ostatnie 20 wiadomości
                });
                
                // Wyślij dane inicjalizacyjne
                sendToPlayer(playerId, { 
                    type: 'init', 
                    id: playerId,
                    mapSize: MAP_SIZE
                });
                
                console.log(`Player ${nickname} (${playerId}) joined`);
            }
            
            if (data.type === 'move' && playerId && players[playerId]) {
                const player = players[playerId];
                const speed = getSpeed(player.r);
                
                player.x += data.dx * speed;
                player.y += data.dy * speed;
                
                // Ograniczenie do mapy
                player.x = Math.max(player.r, Math.min(MAP_SIZE - player.r, player.x));
                player.y = Math.max(player.r, Math.min(MAP_SIZE - player.r, player.y));
                
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
                                
                                delete players[other.id];
                                
                                // Powiadom o zjedzeniu
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
            
        } catch (err) {
            console.error('Error processing message:', err);
        }
    });
    
    ws.on('close', () => {
        if (playerId && players[playerId]) {
            const playerName = players[playerId].nickname;
            
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

console.log(`✅ Server started on port ${PORT}`);
