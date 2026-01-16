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
let cameraX = 0;
let cameraY = 0;
let targetCameraX = 0;
let targetCameraY = 0;

let isVoiceActive = false;
let voiceStream = null;
let mediaRecorder = null;
let audioContext = null;
let audioElements = new Map();
let voiceConnections = new Set();
let voiceSequence = 0;
let isVoiceReady = false;
let isUsingHeadphones = false;
let feedbackDetectionInterval = null;

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
    
    // AUTOMATYCZNY TEST MIKROFONU PO WEJŚCIU DO GRY
    setTimeout(async () => {
        console.log("🔄 Automatyczne uruchamianie voice chatu w grze...");
        
        // Pokazuj komunikat o ładowaniu voice
        updateVoiceStatus('initializing');
        
        try {
            if (playerData.allowVoice !== false) {
                await initVoiceChat();
                if (isVoiceReady) {
                    addChatMessage({
                        type: 'chat',
                        sender: 'SYSTEM',
                        message: '✅ Voice chat w grze został aktywowany! Naciśnij V aby mówić.',
                        color: '#4CAF50',
                        timestamp: Date.now()
                    });
                }
            } else {
                updateVoiceStatus('disabled');
                addChatMessage({
                    type: 'chat',
                    sender: 'SYSTEM',
                    message: '🔇 Voice chat wyłączony w ustawieniach',
                    color: '#9E9E9E',
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            console.error("❌ Nie udało się automatycznie uzyskać dostępu:", error);
            updateVoiceStatus('denied');
            
            addChatMessage({
                type: 'chat',
                sender: 'SYSTEM',
                message: '⚠️ Aby użyć voice chatu, zezwól na dostęp do mikrofonu dla tej strony.',
                color: '#FF9800',
                timestamp: Date.now()
            });
            
            // Dodaj przycisk do ręcznego włączenia
            if (voiceStatus) {
                voiceStatus.innerHTML = '<span style="color:#2196F3; cursor:pointer; text-decoration:underline">Kliknij, by włączyć mikrofon</span>';
                voiceStatus.style.cursor = 'pointer';
                voiceStatus.onclick = async () => {
                    voiceStatus.innerHTML = 'Voice: Ładowanie...';
                    await initVoiceChat();
                };
            }
        }
    }, 1500); // Opóźnienie 1.5 sekundy po załadowaniu gry
}

async function initVoiceChat() {
    try {
        console.log("🔊 Inicjalizacja voice chatu w GRZE...");
        console.log("🔊 Player pozwolił na voice:", playerData.allowVoice);
        
        if (!playerData.allowVoice) {
            updateVoiceStatus('disabled');
            addChatMessage({
                type: 'chat',
                sender: 'SYSTEM',
                message: '🔇 Voice chat wyłączony w ustawieniach',
                color: '#9E9E9E',
                timestamp: Date.now()
            });
            return;
        }
        
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            updateVoiceStatus('unavailable');
            addChatMessage({
                type: 'chat',
                sender: 'SYSTEM',
                message: '⚠️ Twoja przeglądarka nie obsługuje voice chatu',
                color: '#FF9800',
                timestamp: Date.now()
            });
            return;
        }
        
        console.log('🎤 Prośba o dostęp do mikrofonu w GRZE...');
        
        // JAWNA PROŚBA O DOSTĘP DLA STRONY GRY
        voiceStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: { ideal: true },
                noiseSuppression: { ideal: true },
                autoGainControl: { ideal: true },
                channelCount: 1,
                sampleRate: 16000,
                sampleSize: 16,
                volume: 1.0
            },
            video: false
        });
        
        console.log('✅ Dostęp do mikrofonu w GRZE przyznany!');
        
        // Utwórz AudioContext
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000,
                latencyHint: 'interactive'
            });
            
            // Wznów AudioContext jeśli jest zawieszony
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
                console.log('✅ AudioContext wznowiony');
            }
            
            console.log('✅ AudioContext utworzony dla odtwarzania');
        } catch (err) {
            console.warn('⚠️ Nie udało się utworzyć AudioContext:', err);
            // Kontynuuj bez AudioContext
        }
        
        // Pobierz ustawienia słuchawek
        const headphonesConfirmed = localStorage.getItem('headphonesConfirmed');
        if (headphonesConfirmed !== null) {
            isUsingHeadphones = headphonesConfirmed === 'true';
        }
        
        updateVoiceStatus('ready');
        isVoiceReady = true;
        
        addChatMessage({
            type: 'chat',
            sender: 'SYSTEM',
            message: `✅ Voice chat gotowy! ${isUsingHeadphones ? '(Tryb słuchawek 🎧)' : '(Tryb głośników 🔊)'} Naciśnij V aby mówić`,
            color: '#4CAF50',
            timestamp: Date.now()
        });
        
        console.log('🎤 Voice chat w grze zainicjalizowany pomyślnie');
        
    } catch (error) {
        console.error('❌ Błąd dostępu do mikrofonu w grze:', error);
        updateVoiceStatus('denied');
        
        if (error.name === 'NotAllowedError') {
            addChatMessage({
                type: 'chat',
                sender: 'SYSTEM',
                message: '❌ Brak dostępu do mikrofonu. Kliknij ikonę kłódki w pasku adresu i zezwól na dostęp.',
                color: '#F44336',
                timestamp: Date.now()
            });
        } else if (error.name === 'NotFoundError') {
            addChatMessage({
                type: 'chat',
                sender: 'SYSTEM',
                message: '❌ Nie znaleziono mikrofonu. Podłącz mikrofon i spróbuj ponownie.',
                color: '#F44336',
                timestamp: Date.now()
            });
        } else {
            addChatMessage({
                type: 'chat',
                sender: 'SYSTEM',
                message: `❌ Błąd mikrofonu: ${error.message}`,
                color: '#F44336',
                timestamp: Date.now()
            });
        }
        
        // Dodaj przycisk do ponownej próby
        if (voiceStatus) {
            voiceStatus.innerHTML = '<span style="color:#2196F3; cursor:pointer; text-decoration:underline">Kliknij, by ponowić próbę</span>';
            voiceStatus.style.cursor = 'pointer';
            voiceStatus.onclick = async () => {
                voiceStatus.innerHTML = 'Voice: Ładowanie...';
                await initVoiceChat();
            };
        }
    }
}

function updateVoiceStatus(status) {
    if (!voiceStatus || !voiceIndicator) return;
    
    switch(status) {
        case 'initializing':
            voiceStatus.textContent = 'Voice: Inicjalizacja...';
            voiceIndicator.style.background = '#FFC107';
            break;
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
            voiceStatus.textContent = isUsingHeadphones ? 'Voice: Gotowy 🎧' : 'Voice: Gotowy 🔊';
            voiceIndicator.style.background = '#4CAF50';
            break;
        case 'active':
            voiceStatus.textContent = isUsingHeadphones ? 'Voice: Mówię 🎧' : 'Voice: Mówię 🔊';
            voiceIndicator.style.background = '#FF9800';
            break;
        case 'error':
            voiceStatus.textContent = 'Voice: Błąd';
            voiceIndicator.style.background = '#F44336';
            break;
    }
}

async function toggleVoiceChat() {
    console.log("🔘 Przełączanie voice chat, gotowy:", isVoiceReady, "aktywny:", isVoiceActive);
    
    if (!isVoiceReady) {
        console.log("⏳ Voice chat niegotowy, próba inicjalizacji...");
        await initVoiceChat();
        return;
    }
    
    if (isVoiceActive) {
        console.log("⏹️ Zatrzymywanie voice chat...");
        stopVoiceChat();
    } else {
        console.log("▶️ Uruchamianie voice chat...");
        startVoiceChat();
    }
}

function startVoiceChat() {
    if (!voiceStream || isVoiceActive) return;
    
    try {
        console.log('🎤 Rozpoczynanie voice chat w grze...');
        
        // Sprawdź dostępne formaty
        const mimeTypes = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/mp4',
            'audio/mpeg'
        ];
        
        let selectedMimeType = '';
        for (const mimeType of mimeTypes) {
            if (MediaRecorder.isTypeSupported(mimeType)) {
                selectedMimeType = mimeType;
                console.log(`✅ Używanie mime type: ${mimeType}`);
                break;
            }
        }
        
        if (!selectedMimeType) {
            selectedMimeType = 'audio/webm';
            console.log('⚠️ Nie znaleziono wspieranego mime type, używam domyślnego');
        }
        
        const options = {
            mimeType: selectedMimeType,
            audioBitsPerSecond: 128000
        };
        
        // Utwórz MediaRecorder
        mediaRecorder = new MediaRecorder(voiceStream, options);
        
        let audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                audioChunks.push(event.data);
                
                // Gdy skończy się nagrywanie, wyślij dane
                if (mediaRecorder.state === 'inactive') {
                    sendAudioChunks(audioChunks);
                    audioChunks = [];
                }
            }
        };
        
        mediaRecorder.onerror = (error) => {
            console.error('❌ MediaRecorder error:', error);
            updateVoiceStatus('error');
        };
        
        mediaRecorder.onstart = () => {
            console.log('🎤 Nagrywanie rozpoczęte');
        };
        
        mediaRecorder.onstop = () => {
            console.log('🎤 Nagrywanie zatrzymane');
        };
        
        // Zacznij nagrywanie
        mediaRecorder.start(250); // Zbieraj dane co 250ms
        
        isVoiceActive = true;
        
        sendVoiceStatus('talking');
        updateVoiceStatus('active');
        
        if (voiceToggle) {
            voiceToggle.classList.add('active');
            voiceToggle.innerHTML = '<i class="fas fa-microphone-slash"></i>';
            voiceToggle.style.background = 'linear-gradient(135deg, #FF5252 0%, #D32F2F 100%)';
        }
        
        console.log('✅ Voice chat w grze rozpoczęty pomyślnie');
        
    } catch (error) {
        console.error('❌ Błąd rozpoczynania voice chat w grze:', error);
        updateVoiceStatus('error');
        
        addChatMessage({
            type: 'chat',
            sender: 'SYSTEM',
            message: '❌ Błąd podczas uruchamiania voice chatu',
            color: '#F44336',
            timestamp: Date.now()
        });
    }
}

async function sendAudioChunks(chunks) {
    try {
        if (!chunks.length || !ws || ws.readyState !== WebSocket.OPEN || !myId) {
            console.log('⚠️ Nie można wysłać audio: brak chunków, brak połączenia, lub brak ID');
            return;
        }
        
        // Połącz chunki w jeden blob
        const blob = new Blob(chunks, { type: 'audio/webm' });
        
        if (blob.size < 100) {
            console.log('⚠️ Audio blob zbyt mały:', blob.size);
            return;
        }
        
        // Konwertuj blob na base64
        const base64Audio = await blobToBase64(blob);
        
        console.log(`📤 Wysyłanie audio: ${base64Audio.length} bajtów, seq: ${voiceSequence}`);
        
        // Wyślij dane
        ws.send(JSON.stringify({
            type: 'voiceAudio',
            audio: base64Audio,
            sequence: voiceSequence++
        }));
        
    } catch (error) {
        console.error('❌ Błąd wysyłania audio:', error);
    }
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function stopVoiceChat() {
    if (mediaRecorder && isVoiceActive) {
        mediaRecorder.stop();
        isVoiceActive = false;
        
        sendVoiceStatus('silent');
        updateVoiceStatus('ready');
        
        if (voiceToggle) {
            voiceToggle.classList.remove('active');
            voiceToggle.innerHTML = '<i class="fas fa-microphone"></i>';
            voiceToggle.style.background = '';
        }
        
        console.log('✅ Voice chat zatrzymany');
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

function playVoiceAudio(fromPlayerId, audioData, volume = 1.0) {
    try {
        console.log(`🔊 Odtwarzanie audio od ${fromPlayerId}, głośność: ${volume}, rozmiar danych: ${audioData?.length || 0}`);
        
        if (!audioData || audioData.length < 10) {
            console.warn('⚠️ Dane audio zbyt małe lub puste');
            return;
        }
        
        // Utwórz AudioContext jeśli nie istnieje
        if (!audioContext || audioContext.state === 'closed') {
            try {
                audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: 16000,
                    latencyHint: 'interactive'
                });
                console.log('✅ AudioContext utworzony w playVoiceAudio');
            } catch (err) {
                console.error('❌ Błąd tworzenia AudioContext:', err);
                return;
            }
        }
        
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log('✅ AudioContext wznowiony');
            }).catch(err => {
                console.error('❌ Błąd wznawiania AudioContext:', err);
            });
        }
        
        // Konwertuj base64 na ArrayBuffer
        try {
            const binaryString = atob(audioData);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            // Utwórz blob
            const blob = new Blob([bytes], { type: 'audio/webm' });
            const audioUrl = URL.createObjectURL(blob);
            
            // Utwórz element audio
            const audioElement = new Audio();
            audioElement.autoplay = true;
            
            // Dostosuj głośność (ogranicz do 50% dla komfortu)
            const adjustedVolume = Math.max(0.05, Math.min(0.5, volume * 0.5));
            audioElement.volume = adjustedVolume;
            
            audioElement.src = audioUrl;
            
            // Pokaż aktywność voice
            showVoiceActivity(fromPlayerId, true);
            
            audioElement.onplay = () => {
                console.log(`🔊 Audio rozpoczęło odtwarzanie od ${fromPlayerId}`);
            };
            
            audioElement.onended = () => {
                console.log(`🔊 Audio zakończone od ${fromPlayerId}`);
                showVoiceActivity(fromPlayerId, false);
                URL.revokeObjectURL(audioUrl);
            };
            
            audioElement.onerror = (error) => {
                console.error('❌ Błąd odtwarzania audio:', error);
                showVoiceActivity(fromPlayerId, false);
                URL.revokeObjectURL(audioUrl);
            };
            
            // Spróbuj odtworzyć
            audioElement.play().catch(err => {
                console.error('❌ Błąd odtwarzania elementu audio:', err);
                showVoiceActivity(fromPlayerId, false);
            });
            
        } catch (error) {
            console.error('❌ Błąd przetwarzania danych audio:', error);
            showVoiceActivity(fromPlayerId, false);
        }
        
    } catch (error) {
        console.error('❌ Błąd w playVoiceAudio:', error);
        showVoiceActivity(fromPlayerId, false);
    }
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
            ${isUsingHeadphones ? '<span class="headphone-icon">🎧</span>' : '<span class="speaker-icon">🔊</span>'}
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
    if (!voiceConnections.has(playerId)) {
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
        
        console.log(`🔊 Voice połączony z ${nickname}`);
    }
}

function handleVoiceDisconnect(playerId) {
    if (voiceConnections.has(playerId)) {
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
        
        console.log(`🔇 Voice rozłączony od ${playerId}`);
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
        
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                sendChatMessage();
            }
        });
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
        if (chatOpen) {
            chatInput.focus();
        }
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
        unreadBadge.textContent = unreadMessages > 9 ? '9+' : unreadMessages;
        unreadBadge.style.display = 'flex';
    } else {
        unreadBadge.style.display = 'none';
    }
}

window.addEventListener("keydown", e => {
    const key = e.key.toLowerCase();
    keys[key] = true;
    
    if (key === 'v' && isVoiceReady && !isVoiceActive && !keys.chatFocused) {
        e.preventDefault();
        startVoiceChat();
        return;
    }
    
    if (key === 't' && !keys.chatFocused) {
        e.preventDefault();
        toggleChat();
        return;
    }
    
    if (key === 'escape' && chatOpen) {
        e.preventDefault();
        closeChat();
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
    
    ws.send(JSON.stringify({
        type: "join",
        nickname: playerData.nickname || "Player"
    }));
    
    addChatMessage({
        type: 'chat',
        sender: 'SYSTEM',
        message: '✅ Połączono z serwerem gry',
        color: '#4CAF50',
        timestamp: Date.now()
    });
};

ws.onerror = (e) => {
    console.error("❌ WebSocket error", e);
    addChatMessage({
        type: 'chat',
        sender: 'SYSTEM',
        message: '❌ Błąd połączenia z serwerem',
        color: '#F44336',
        timestamp: Date.now()
    });
};

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
        console.log(`📥 Otrzymano: ${data.type}`);
        
        switch(data.type) {
            case "init":
                myId = data.id;
                mapSize = data.mapSize || 5000;
                voiceRange = data.voiceRange || 200;
                const voiceRangeInfo = document.getElementById('voiceRangeInfo');
                if (voiceRangeInfo) {
                    voiceRangeInfo.textContent = `${voiceRange/10}m`;
                }
                console.log(`🎮 Gracz zainicjalizowany: ${myId}, zasięg voice: ${voiceRange}`);
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
                console.log(`🔊 Voice connect z ${data.nickname}, dystans: ${data.distance}`);
                handleVoiceConnect(data.playerId, data.nickname, data.distance);
                break;
                
            case "voiceDisconnect":
                console.log(`🔊 Voice disconnect od ${data.playerId}`);
                handleVoiceDisconnect(data.playerId);
                break;
                
            case "voiceAudio":
                console.log(`🔊 Voice audio od ${data.nickname || data.from}, głośność: ${data.volume}, dystans: ${data.distance}, seq: ${data.sequence}`);
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
                console.log(`🔊 Voice status update: ${data.playerId} jest ${data.status}`);
                showVoiceActivity(data.playerId, data.status === 'talking');
                break;
                
            case "pong":
                break;
        }
    } catch (err) {
        console.error("❌ Błąd parsowania danych:", err, e.data);
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
    
    const me = players.find(p => p.id === myId);
    if (me) {
        targetCameraX = canvas.width / 2 - me.x * zoom;
        targetCameraY = canvas.height / 2 - me.y * zoom;
        
        cameraX += (targetCameraX - cameraX) * 0.1;
        cameraY += (targetCameraY - cameraY) * 0.1;
    }
}

function draw() {
    ctx.fillStyle = '#f0f8ff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const me = players.find(p => p.id === myId);
    if (!me) return;
    
    ctx.save();
    ctx.translate(cameraX, cameraY);
    ctx.scale(zoom, zoom);
    
    drawGrid();
    
    players.forEach(p => {
        const x = p.x;
        const y = p.y;
        
        const screenX = x * zoom + cameraX;
        const screenY = y * zoom + cameraY;
        const visibleRadius = p.r * zoom;
        
        if (screenX + visibleRadius < 0 || screenX - visibleRadius > canvas.width || 
            screenY + visibleRadius < 0 || screenY - visibleRadius > canvas.height) {
            return;
        }
        
        ctx.beginPath();
        ctx.arc(x, y, p.r, 0, Math.PI * 2);
        
        ctx.fillStyle = p.color || (p.id === myId ? playerColor : '#2196F3');
        ctx.fill();
        
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#000';
        ctx.stroke();
        
        ctx.fillStyle = '#000';
        ctx.font = `${Math.max(12, p.r / 2)}px Arial`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        
        const displayName = p.r < 30 ? p.nickname?.substr(0, 3) : p.nickname;
        ctx.fillText(displayName || "Player", x, y);
        
        if (p.r > 25) {
            ctx.font = `${Math.max(10, p.r / 3)}px Arial`;
            ctx.fillStyle = '#333';
            ctx.fillText(`${Math.round(p.r)}`, x, y + p.r / 2 + 10);
        }
        
        if (p.isSpeaking) {
            const pulse = (Math.sin(Date.now() / 200) + 1) * 0.3;
            ctx.beginPath();
            ctx.arc(x, y, p.r + 10 + pulse * 5, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 152, 0, ${0.5 + pulse * 0.3})`;
            ctx.lineWidth = 3;
            ctx.stroke();
            
            ctx.fillStyle = '#FF9800';
            ctx.font = 'bold 20px Arial';
            ctx.fillText('🎤', x, y - p.r - 15);
        }
    });
    
    ctx.restore();
    
    drawMinimap(me);
    drawVoiceRange(me);
}

function drawGrid() {
    const gridSize = 50;
    const offsetX = Math.abs(cameraX) % (gridSize * zoom);
    const offsetY = Math.abs(cameraY) % (gridSize * zoom);
    
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    
    const startX = -cameraX / zoom - offsetX;
    const endX = startX + canvas.width / zoom + gridSize;
    const startY = -cameraY / zoom - offsetY;
    const endY = startY + canvas.height / zoom + gridSize;
    
    for (let x = startX; x < endX; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
        ctx.stroke();
    }
    
    for (let y = startY; y < endY; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();
    }
}

function drawMinimap(me) {
    const minimapSize = 200;
    const margin = 30;
    const scale = minimapSize / mapSize;
    
    ctx.save();
    
    // Tło z cieniem
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 5;
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fillRect(canvas.width - minimapSize - margin, margin, minimapSize, minimapSize);
    
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    // Obramowanie
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 4;
    ctx.strokeRect(canvas.width - minimapSize - margin, margin, minimapSize, minimapSize);
    
    // Zasięg voice chatu na minimapie
    ctx.fillStyle = 'rgba(33, 150, 243, 0.1)';
    ctx.beginPath();
    ctx.arc(
        canvas.width - minimapSize - margin + me.x * scale,
        margin + me.y * scale,
        voiceRange * scale,
        0,
        Math.PI * 2
    );
    ctx.fill();
    
    // Gracze
    players.forEach(p => {
        const x = canvas.width - minimapSize - margin + p.x * scale;
        const y = margin + p.y * scale;
        const r = Math.max(4, p.r * scale * 0.3);
        
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = p.id === myId ? playerColor : '#2196F3';
        ctx.fill();
        
        if (p.id === myId) {
            ctx.strokeStyle = '#FF0000';
            ctx.lineWidth = 3;
            ctx.stroke();
        }
        
        if (p.isSpeaking) {
            ctx.fillStyle = '#FF9800';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('🎤', x, y - r - 5);
        }
    });
    
    // Info box
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(canvas.width - minimapSize - margin, margin + minimapSize + 5, minimapSize, 30);
    
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
        `ZOOM: ${zoom.toFixed(1)}x | VOICE: ${voiceConnections.size}`, 
        canvas.width - minimapSize - margin + minimapSize/2, 
        margin + minimapSize + 20
    );
    
    ctx.restore();
}

function drawVoiceRange(me) {
    ctx.save();
    
    // Zasięg voice chatu
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    ctx.arc(canvas.width/2, canvas.height/2, voiceRange * zoom, 0, Math.PI * 2);
    ctx.fillStyle = '#2196F3';
    ctx.fill();
    
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = '#2196F3';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    ctx.restore();
    
    // Info box
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(25, canvas.height - 60, 180, 40);
    
    ctx.fillStyle = isUsingHeadphones ? '#4CAF50' : '#FF9800';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`VOICE CHAT: ${voiceConnections.size}`, 35, canvas.height - 40);
    
    ctx.fillStyle = '#fff';
    ctx.font = '14px Arial';
    ctx.fillText(isUsingHeadphones ? '🎧 SLUCHAWKI' : '🔊 GLOSNIKI', 35, canvas.height - 20);
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
    
    const voiceCountElement = document.getElementById('voiceCount');
    if (voiceCountElement) {
        voiceCountElement.textContent = voiceConnections.size;
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
    
    if (voiceStream) {
        voiceStream.getTracks().forEach(track => track.stop());
    }
    
    // Wyczyść wszystkie audio URL
    audioElements.forEach(audio => {
        if (audio.src && audio.src.startsWith('blob:')) {
            URL.revokeObjectURL(audio.src);
        }
    });
});

// Ping serwera co 20 sekund
setInterval(() => {
    if (ws.readyState === WebSocket.OPEN && myId) {
        ws.send(JSON.stringify({
            type: 'ping'
        }));
    }
}, 20000);

// Dodaj automatyczne wznawianie AudioContext po interakcji użytkownika
document.addEventListener('click', async () => {
    if (audioContext && audioContext.state === 'suspended') {
        try {
            await audioContext.resume();
            console.log('✅ AudioContext wznowiony po interakcji użytkownika');
        } catch (err) {
            console.error('❌ Błąd wznawiania AudioContext:', err);
        }
    }
});

// Dodaj debugowanie voice chatu
function testVoiceChat() {
    console.log('🔊 Voice Chat Debug Info:');
    console.log('- Voice stream:', voiceStream ? '✓' : '✗');
    console.log('- Audio context:', audioContext ? audioContext.state : 'none');
    console.log('- Is voice ready:', isVoiceReady);
    console.log('- Is voice active:', isVoiceActive);
    console.log('- Media recorder:', mediaRecorder ? mediaRecorder.state : 'none');
    console.log('- Voice connections:', voiceConnections.size);
    console.log('- Players in range:', players.filter(p => p.id !== myId).length);
}

// Dodaj klawisz debugowania (F12)
window.addEventListener('keydown', e => {
    if (e.key === 'F12') {
        e.preventDefault();
        testVoiceChat();
    }
});

// Dodaj style CSS
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    
    @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
    }
    
    @keyframes slideInUp {
        from { 
            opacity: 0;
            transform: translateY(50px);
        }
        to { 
            opacity: 1;
            transform: translateY(0);
        }
    }
    
    @keyframes slideOutDown {
        from { 
            opacity: 1;
            transform: translateY(0);
        }
        to { 
            opacity: 0;
            transform: translateY(50px);
        }
    }
    
    @keyframes pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.1); opacity: 0.8; }
    }
    
    .headphone-icon {
        color: #4CAF50;
        font-size: 1rem;
        margin-left: 8px;
        animation: pulse 2s infinite;
    }
    
    .speaker-icon {
        color: #FF9800;
        font-size: 1rem;
        margin-left: 8px;
        animation: pulse 2s infinite;
    }
    
    .voice-user.speaking {
        animation: pulse 1s infinite;
    }
`;
document.head.appendChild(style);
