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
// 🔥 Uwaga: Zaktualizuj URL zgodnie z Twoim serwerem Render
const ws = new WebSocket("wss://agari-qfuc.onrender.com");

let myId = null;
let players = [];
const keys = {};
let mapSize = 5000;

// Eventy klawiatury
window.addEventListener("keydown", e => {
    keys[e.key.toLowerCase()] = true;
});
window.addEventListener("keyup", e => {
    keys[e.key.toLowerCase()] = false;
});

// Obsługa dotyku (dla urządzeń mobilnych)
let touchStart = null;
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    touchStart = {x: e.touches[0].clientX, y: e.touches[0].clientY};
});

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!touchStart) return;
    
    const touch = e.touches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    
    // Normalizacja wektora kierunku
    const length = Math.sqrt(dx*dx + dy*dy);
    if (length > 10) {
        keys.moveX = dx / length;
        keys.moveY = dy / length;
    }
});

canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    touchStart = null;
    keys.moveX = 0;
    keys.moveY = 0;
});

// Logowanie połączenia
ws.onopen = () => {
    console.log("✅ WebSocket połączony");
    
    // Dołącz do gry
    ws.send(JSON.stringify({
        type: "join",
        nickname: playerData.nickname || "Player"
    }));
};

ws.onerror = (e) => console.error("❌ WebSocket error", e);
ws.onclose = () => {
    console.warn("⚠️ WebSocket zamknięty");
    alert("Utracono połączenie z serwerem!");
    setTimeout(() => window.location.href = 'index.html', 2000);
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
                    alert("Zostałeś zjedzony! Wracasz do menu.");
                    setTimeout(() => window.location.href = 'index.html', 1000);
                }
                break;
        }
    } catch (err) {
        console.error("Błąd parsowania danych:", err);
    }
};

// Aktualizacja pozycji gracza
function update() {
    if (!myId || ws.readyState !== WebSocket.OPEN) return;
    
    let dx = 0, dy = 0;
    
    // Sterowanie klawiaturą
    if (keys["w"] || keys["arrowup"]) dy -= 1;
    if (keys["s"] || keys["arrowdown"]) dy += 1;
    if (keys["a"] || keys["arrowleft"]) dx -= 1;
    if (keys["d"] || keys["arrowright"]) dx += 1;
    
    // Sterowanie dotykiem
    if (keys.moveX && keys.moveY) {
        dx = keys.moveX;
        dy = keys.moveY;
    }
    
    // Normalizacja wektora (aby ruch po skosie nie był szybszy)
    if (dx !== 0 || dy !== 0) {
        const length = Math.sqrt(dx*dx + dy*dy);
        dx /= length;
        dy /= length;
        
        // Wysyłamy ruch do serwera
        ws.send(JSON.stringify({ type: "move", dx, dy }));
    }
}

// Rysowanie gry
function draw() {
    // Tło
    ctx.fillStyle = '#f0f8ff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Siatka tła
    drawGrid();
    
    const me = players.find(p => p.id === myId);
    if (!me) return;
    
    // Aktualizuj rozmiar gracza w HUD
    document.getElementById('playerSize').textContent = Math.round(me.r);
    
    // Rysuj wszystkich graczy
    players.forEach(p => {
        // Oblicz pozycję względem naszego gracza (kamera podąża za graczem)
        const x = canvas.width / 2 + (p.x - me.x);
        const y = canvas.height / 2 + (p.y - me.y);
        
        // Sprawdź czy gracz jest w widoku
        if (x + p.r < 0 || x - p.r > canvas.width || 
            y + p.r < 0 || y - p.r > canvas.height) {
            return;
        }
        
        // Rysuj kulkę
        ctx.beginPath();
        ctx.arc(x, y, p.r, 0, Math.PI * 2);
        
        // Kolor kulki
        ctx.fillStyle = p.color || (p.id === myId ? playerColor : '#2196F3');
        ctx.fill();
        
        // Obwódka
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#000';
        ctx.stroke();
        
        // Nickname
        ctx.fillStyle = '#000';
        ctx.font = `${Math.max(12, p.r/2)}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        
        // Skrócony nickname jeśli kulka mała
        const displayName = p.r < 30 ? p.nickname?.substr(0, 3) : p.nickname;
        ctx.fillText(displayName || "Player", x, y);
        
        // Rozmiar
        if (p.r > 25) {
            ctx.font = `${Math.max(10, p.r/3)}px Arial`;
            ctx.fillStyle = '#333';
            ctx.fillText(`${Math.round(p.r)}`, x, y + p.r/2 + 10);
        }
    });
    
    // Rysuj minimapę
    drawMinimap(me);
}

// Rysowanie siatki tła
function drawGrid() {
    const gridSize = 50;
    const offsetX = (canvas.width / 2) % gridSize;
    const offsetY = (canvas.height / 2) % gridSize;
    
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    
    // Linie pionowe
    for (let x = offsetX; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    
    // Linie poziome
    for (let y = offsetY; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
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
    if (me && me.color) {
        document.getElementById('playerCircle').style.background = me.color;
    }
}

// Główna pętla gry
function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

// Uruchom grę
gameLoop();
