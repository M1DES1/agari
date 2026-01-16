const WebSocket = require('ws');
const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

const players = {};
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

wss.on('connection', ws => {
    let playerId = null;
    let nickname = "Player";
    
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
                    color: '#' + Math.floor(Math.random()*16777215).toString(16)
                };
                
                ws.send(JSON.stringify({ 
                    type: 'init', 
                    id: playerId,
                    mapSize: MAP_SIZE
                }));
                
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
                                delete players[other.id];
                                
                                // Powiadom o zjedzeniu
                                wss.clients.forEach(client => {
                                    if (client.readyState === WebSocket.OPEN) {
                                        client.send(JSON.stringify({
                                            type: 'eat',
                                            eater: playerId,
                                            eaten: other.id
                                        }));
                                    }
                                });
                            }
                        }
                    }
                });
            }
            
        } catch (err) {
            console.error('Error processing message:', err);
        }
    });
    
    ws.on('close', () => {
        if (playerId && players[playerId]) {
            console.log(`Player ${players[playerId].nickname} (${playerId}) disconnected`);
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
