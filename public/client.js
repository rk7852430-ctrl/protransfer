// Ask for Notification Permission on load
if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
    Notification.requestPermission();
}

const socket = io();
const fileInput = document.getElementById('file-input');
const folderInput = document.getElementById('folder-input');
const dropZone = document.getElementById('drop-zone');
const fileInfo = document.getElementById('file-info');
const fileNameSpan = document.getElementById('file-name');
const fileSizeSpan = document.getElementById('file-size');
const linkBox = document.getElementById('link-box');
const shareLinkInput = document.getElementById('share-link');
const sendBtn = document.getElementById('send-btn');
const downloadBtn = document.getElementById('download-btn');
const selectionButtons = document.getElementById('selection-buttons');

let peerConnection;
let dataChannel;
let selectedFile = null;
let isWaitingToSend = false;
let fileQueue = [];
let currentFileIndex = 0;
let isDownloadingMultiple = false;
let receiveBuffer = [];
let receivedSize = 0;
let incomingFileInfo = {};
let directoryHandle = null; 
let isSending = false; 
window.currentSelectionType = window.currentSelectionType || 'file';

// 🔥 NEW: Time Calculate karne ke variables (Receiver Side)
let lastRecvTime = 0;
let lastRecvBytes = 0;
let currentRecvSpeed = 0;

let roomId = window.location.hash.substring(1);
let isReceiver = roomId.length > 0;

if (!isReceiver) {
    roomId = "room" + Math.random().toString(36).substring(2, 12);
    window.location.hash = roomId;
} else {
    document.getElementById('status-desc').innerText = "Connecting to Sender... Please wait.";
    document.getElementById('receive-input-box').style.display = 'flex';
    document.getElementById('join-link-input').style.display = 'none';
    const recvBtnUI = document.querySelector('#receive-input-box button');
    if(recvBtnUI) recvBtnUI.style.display = 'none';
    if(selectionButtons) selectionButtons.style.display = 'none';
}

if(shareLinkInput) shareLinkInput.value = window.location.href;

socket.on('connect', () => {
    console.log("✅ Socket Connected! Joining Room:", roomId);
    socket.emit('join-room', roomId);
});

const configuration = { 'iceServers': [{'urls': 'stun:stun.l.google.com:19302'}] };

function triggerCelebration() {
    var duration = 3 * 1000;
    var end = Date.now() + duration;
    (function frame() {
        confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 }, colors: ['#facc15', '#22c55e', '#ffffff'] });
        confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 }, colors: ['#facc15', '#22c55e', '#ffffff'] });
        if (Date.now() < end) { requestAnimationFrame(frame); }
    }());
}

// 🔥 NEW: Time Format Karne ka Smart Function (01h 05m 12s)
function formatTime(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return "0s";
    let h = Math.floor(seconds / 3600);
    let m = Math.floor((seconds % 3600) / 60);
    let s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

// ------------------------------------------------------------------
// WebRTC Connection Logic
// ------------------------------------------------------------------
function createConnection() {
    if (peerConnection) { peerConnection.close(); }
    peerConnection = new RTCPeerConnection(configuration);

    if (!isReceiver) {
        dataChannel = peerConnection.createDataChannel('fileTransfer');
        setupDataChannel(dataChannel);
    } else {
        peerConnection.ondatachannel = (event) => {
            dataChannel = event.channel;
            setupDataChannel(dataChannel);
            if(document.getElementById('status-desc')) document.getElementById('status-desc').innerText = "Connected! Sender is selecting files.";
            const circleIcon = document.querySelector('.action-circle i');
            if(circleIcon) circleIcon.className = "fa-solid fa-check";
        };
    }

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) socket.emit('ice-candidate', { candidate: event.candidate, room: roomId });
    };
}

let fileWritableStream = null;

function setupDataChannel(channel) {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
        document.getElementById('chat-status').innerHTML = "🟢 Online";
        document.getElementById('chat-status').className = "status-online";
        console.log('✅ Data Channel Connected!');
        if (!isReceiver) {
            if(isWaitingToSend) sendMetadata();
        } else {
            if(document.getElementById('status-desc')) document.getElementById('status-desc').innerText = "Connected! Fetching file details...";
            setTimeout(() => {
                if (dataChannel && dataChannel.readyState === 'open') {
                    dataChannel.send(JSON.stringify({ type: 'request-metadata' }));
                }
            }, 500);
        }
    };

    channel.onmessage = async (e) => {
        if (typeof e.data === 'string') {
            const data = JSON.parse(e.data);
           // Chat receive karne ka logic (With Badge & Read Receipts)
if (data.type === 'chat-message') {
    appendMessage(data.content, 'received');
    
    // Check karo kya chat dabba band hai?
    const popup = document.getElementById('chat-popup');
    if (popup.classList.contains('hidden')) {
        unreadCount++; // Number badao
        const badge = document.getElementById('chat-badge');
        badge.innerText = unreadCount;
        badge.classList.remove('hidden'); // Red badge dikhao
    } else {
        // Agar dabba khula hai toh turant Read Receipt bhej do
        if (dataChannel && dataChannel.readyState === 'open') {
            dataChannel.send(JSON.stringify({ type: 'chat-read' }));
        }
    }

    if (navigator.vibrate) navigator.vibrate([20, 50, 20]); 
    try {
        let msgSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3');
        msgSound.play();
    } catch(e) {}
    
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        new Notification("New Message - ProTransfer", { body: data.content, icon: "favicon.png" });
    }
    return;
}

// Agar doosre user ne chat dabba khol liya (Double Tick Logic)
if (data.type === 'chat-read') {
    const unreadTicks = document.querySelectorAll('.unread-tick');
    unreadTicks.forEach(tick => {
        // Ekdum chamakta hua Bright Blue (#007bff) aur bada size!
        tick.innerHTML = '<span style="color: #007bff !important; font-size: 14px; font-weight: 900;">✓✓</span>'; 
        tick.classList.replace('unread-tick', 'read-tick');
    });
    return;
}

            if (data.type === 'request-metadata') {
                if (!isReceiver && selectedFile) {
                    isWaitingToSend = true;
                    sendMetadata();
                }
            }
            else if (data.type === 'metadata') {
                incomingFileInfo = data;
                if (fileNameSpan) fileNameSpan.innerText = data.uiName || data.name;
                if (fileSizeSpan) fileSizeSpan.innerText = ((data.uiSize || data.size) / 1048576).toFixed(2) + ' MB';
                if (fileInfo) fileInfo.style.display = 'flex';

                // Timer reset karo nayi file ke liye
                lastRecvTime = Date.now();
                lastRecvBytes = 0;
                currentRecvSpeed = 0;

                if (isDownloadingMultiple) {
                    if (directoryHandle) {
                        try {
                            const fileHandle = await directoryHandle.getFileHandle(incomingFileInfo.name, { create: true });
                            fileWritableStream = await fileHandle.createWritable();
                        } catch (err) {
                            console.warn("Folder me file banane me error:", err);
                            fileWritableStream = null;
                        }
                    }
                    dataChannel.send(JSON.stringify({ type: 'request-download' }));
                } else {
                    if(downloadBtn) downloadBtn.style.display = 'inline-block';
                    if(downloadBtn) downloadBtn.innerText = "Download Now";
                    const recvInputBox = document.getElementById('receive-input-box');
                    if(recvInputBox) recvInputBox.style.display = 'none';
                    if(document.getElementById('status-title')) document.getElementById('status-title').innerText = "File Ready to Download";
                    if(document.getElementById('status-desc')) document.getElementById('status-desc').innerText = "";
                }
            }
            else if (data.type === 'request-download') {
                startSendingChunks();
            }
            else if (data.type === 'end') {
                if (fileWritableStream) {
                    await fileWritableStream.close(); 
                    fileWritableStream = null;
                }
                
                const historyBox = document.getElementById('history-box');
                const historyList = document.getElementById('history-list');
                if (historyBox && historyList) {
                    historyBox.style.display = 'block';
                    const sizeMB = (incomingFileInfo.size / 1048576).toFixed(2);
                    const newItem = document.createElement('div');
                    newItem.style.cssText = "display: flex; justify-content: space-between; padding: 10px; word-break: break-all; word-wrap: break-word; background: rgba(255,255,255,0.05); margin-bottom: 5px; border-radius: 5px; border-left: 4px solid #22c55e;";
                    newItem.innerHTML = `<div><i class="fas fa-file-download" style="color:#22c55e; margin-right: 10px;"></i> <span style="color:#fff; word-break: break-all; word-wrap: break-word; ">${incomingFileInfo.name}</span></div><div style="color: #94a3b8;">${sizeMB} MB</div>`;
                    historyList.appendChild(newItem);
                }
                receivedSize = 0;
                
                if (dataChannel && dataChannel.readyState === 'open') {
                    dataChannel.send(JSON.stringify({ type: 'file-saved' }));
                }
            }
            else if (data.type === 'file-saved') {
                moveToNextFile();
            }
            else if (data.type === 'all-complete') {
                triggerCelebration();
                // 👇 YAHAN STOP CODE JODEIN 👇
        window.isTransferActive = false;
        if(document.getElementById('transferWarning')) document.getElementById('transferWarning').style.display = 'none';
        // 👆 ---------------------- 👆
                if(document.getElementById('status-title')) document.getElementById('status-title').innerText = "All Files Downloaded Successfully!";
                if(downloadBtn) downloadBtn.style.display = 'none';
                isDownloadingMultiple = false;
                directoryHandle = null;
            setTimeout(() => {
            if (typeof triggerPremiumHaptic === 'function') triggerPremiumHaptic();
            showPremiumAlert(); // 👈 Purane alert ki jagah bas yeh naam aayega
        }, 3500);
            }
        } else if (e.data instanceof ArrayBuffer) {
            if (fileWritableStream) {
                await fileWritableStream.write(new Uint8Array(e.data));
            } else {
                receiveBuffer.push(e.data);
            }
            receivedSize += e.data.byteLength;
            
            // 🔥 NEW: Receiver Side Speed & Time Calculation
            let now = Date.now();
            if (now - lastRecvTime >= 1000) { // Har 1 second me speed check hogi
                currentRecvSpeed = (receivedSize - lastRecvBytes) / ((now - lastRecvTime) / 1000);
                lastRecvTime = now;
                lastRecvBytes = receivedSize;
            }

            let percentage = Math.round((receivedSize / incomingFileInfo.size) * 100);
            let timeText = "Calc...";
            if (currentRecvSpeed > 0) {
                let remainingBytes = incomingFileInfo.size - receivedSize;
                timeText = formatTime(remainingBytes / currentRecvSpeed);
            }

            if (downloadBtn) downloadBtn.innerText = `Downloading... ${percentage}% [${timeText}]`;

            if (!fileWritableStream && receivedSize === incomingFileInfo.size) {
                const blob = new Blob(receiveBuffer);
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = incomingFileInfo.name;
                a.click();
                receiveBuffer = [];
                receivedSize = 0;
            }
        }
    };
}

socket.on('offer', async (offer) => {
    if (!peerConnection) createConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { answer: answer, room: roomId });
});

socket.on('answer', async (answer) => {
    if(peerConnection) await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('ice-candidate', async (candidate) => {
    try { if(peerConnection) await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
});

socket.on('client-joined', () => {
    console.log("🔥 SENDER LOG: Client joined the room!");
    if (!isReceiver) {
        createConnection();
        peerConnection.createOffer().then(offer => {
            peerConnection.setLocalDescription(offer);
            socket.emit('offer', { offer: offer, room: roomId });
        });
    }
});

if (fileInput) fileInput.addEventListener('change', (e) => handleFileSelection(e.target.files));
if (folderInput) folderInput.addEventListener('change', (e) => handleFileSelection(e.target.files));

if (dropZone) {
    dropZone.addEventListener('click', () => {
        if (fileInput) fileInput.value = '';
        if (folderInput) folderInput.value = '';
        if (window.currentSelectionType === 'folder') {
            if (folderInput) folderInput.click();
        } else {
            if (fileInput) fileInput.click();
        }
    });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('hover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('hover'));
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('hover'); handleFileSelection(e.dataTransfer.files); });
}

function handleFileSelection(files) {
    if (files.length > 0) {
        isReceiver = false; 
        const newRoomId = "room" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
        roomId = newRoomId;
        window.location.hash = roomId;
        
        if (shareLinkInput) shareLinkInput.value = window.location.href;
        if (peerConnection) { peerConnection.close(); peerConnection = null; dataChannel = null; }
        
        socket.emit('join-room', roomId);
        console.log("✅ Sender selected file & joined new room:", roomId);

        isWaitingToSend = false;
        isDownloadingMultiple = false;
        isSending = false; 
        fileQueue = Array.from(files);
        currentFileIndex = 0;
        selectedFile = fileQueue[0];
        
        let totalSize = fileQueue.reduce((acc, f) => acc + f.size, 0);
        let customName = fileQueue.length > 1 ? (window.currentSelectionType === 'folder' ? `Folder (${fileQueue.length} items)` : `Files (${fileQueue.length} items)`) : selectedFile.name;
        selectedFile.customName = customName;
        selectedFile.customSize = totalSize;
        
        if (fileNameSpan) fileNameSpan.innerText = selectedFile.customName;
        if (fileSizeSpan) fileSizeSpan.innerText = (selectedFile.customSize / 1048576).toFixed(2) + ' MB';
        if (fileInfo) fileInfo.style.display = 'flex';
        if (linkBox) linkBox.style.display = 'block';
        
        if (sendBtn) {
            sendBtn.style.display = 'inline-block';
            sendBtn.innerHTML = "<i class='fa-solid fa-paper-plane'></i> Send Now";
            sendBtn.style.opacity = "1";
            sendBtn.style.cursor = "pointer";
            sendBtn.style.background = "#facc15";
            sendBtn.style.color = "#000";
        }
        if (selectionButtons) selectionButtons.style.display = 'none';
    }
}

function sendMetadata() {
    if (isWaitingToSend && selectedFile && dataChannel && dataChannel.readyState === 'open') {
        let totalSize = fileQueue.reduce((acc, f) => acc + f.size, 0);
        let customName = fileQueue.length > 1 ? (window.currentSelectionType === 'folder' ? `Folder (${fileQueue.length} items)` : `Files (${fileQueue.length} items)`) : selectedFile.name;
        dataChannel.send(JSON.stringify({
            type: 'metadata',
            name: selectedFile.name,
            size: selectedFile.size,
            uiName: customName,
            uiSize: totalSize,
            totalFiles: fileQueue.length 
        }));
        if(sendBtn) sendBtn.innerHTML = "<i class='fa-solid fa-satellite-dish fa-beat'></i> Ready! Waiting for Client...";
    }
}

if (sendBtn) {
    sendBtn.addEventListener('click', () => {
        if (!selectedFile) return;
        sendBtn.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> Waiting for Client...";
        sendBtn.style.opacity = "0.8";
        sendBtn.style.cursor = "wait";
        isWaitingToSend = true;
        if (dataChannel && dataChannel.readyState === 'open') {
            sendMetadata();
        }
    });
}

if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
        isDownloadingMultiple = true;
         // 👇 YAHAN START CODE JODEIN 👇
        window.isTransferActive = true;
        if(document.getElementById('transferWarning')) document.getElementById('transferWarning').style.display = 'inline-block';
        // 👆 ---------------------- 👆
        downloadBtn.innerText = "Requesting...";

        try {
            if (incomingFileInfo.totalFiles > 1 && window.showDirectoryPicker) {
                directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                const fileHandle = await directoryHandle.getFileHandle(incomingFileInfo.name, { create: true });
                fileWritableStream = await fileHandle.createWritable();
            } else if (window.showSaveFilePicker) {
                const handle = await window.showSaveFilePicker({ suggestedName: incomingFileInfo.name });
                fileWritableStream = await handle.createWritable();
            }
        } catch (err) {
            console.warn('Fallback to memory blob active.', err);
            fileWritableStream = null;
            directoryHandle = null;
        }

        if(dataChannel) dataChannel.send(JSON.stringify({ type: 'request-download' }));
    });
}

// --------------------- NEW SENDER LOGIC (TIME + RACE CONDITION FIXED) ---------------------
async function startSendingChunks() {
    if (isSending) return; 
    if (currentFileIndex >= fileQueue.length) return;
    
    isSending = true; 
    // 👇 YAHAN START CODE JODEIN 👇
    window.isTransferActive = true;
    if(document.getElementById('transferWarning')) document.getElementById('transferWarning').style.display = 'inline-block';
    // 👆 ----------------------
    const file = fileQueue[currentFileIndex];
    const dc = dataChannel;

    // 🔥 NEW: Time Calculate karne ke variables (Sender Side)
    let lastSendTime = Date.now();
    let lastSendBytes = 0;
    let currentSendSpeed = 0;

    if (sendBtn) sendBtn.innerHTML = `<i class='fa-solid fa-arrow-up-from-bracket fa-bounce'></i> Sending ${currentFileIndex + 1}/${fileQueue.length}...`;

    const MAX_BUFFER = 1024 * 1024 * 8; 
    dc.bufferedAmountLowThreshold = 1024 * 1024 * 2; 
    const chunkSize = 262144; 
    let offset = 0;

    try {
        while (offset < file.size) {
            if (dc.bufferedAmount >= MAX_BUFFER) {
                await new Promise(resolve => {
                    dc.onbufferedamountlow = () => {
                        dc.onbufferedamountlow = null;
                        resolve();
                    };
                });
            }

            const slice = file.slice(offset, offset + chunkSize);
            const buffer = await slice.arrayBuffer();

            try {
                dc.send(buffer);
                offset += buffer.byteLength;
                
                // 🔥 NEW: Sender Side Speed & Time Calculation
                let now = Date.now();
                if (now - lastSendTime >= 1000) { // UI update har 1 sec me
                    currentSendSpeed = (offset - lastSendBytes) / ((now - lastSendTime) / 1000);
                    lastSendTime = now;
                    lastSendBytes = offset;

                    let percentage = Math.round((offset / file.size) * 100);
                    let timeText = "Calc...";
                    if (currentSendSpeed > 0) {
                        let remainingBytes = file.size - offset;
                        timeText = formatTime(remainingBytes / currentSendSpeed);
                    }
                    if (sendBtn) sendBtn.innerHTML = `<i class='fa-solid fa-arrow-up-from-bracket fa-bounce'></i> Sending ${currentFileIndex + 1}/${fileQueue.length} : ${percentage}% [${timeText}]`;
                }
            } catch (sendError) {
                if (sendError.name === 'OperationError') {
                    await new Promise(r => setTimeout(r, 50));
                    continue; 
                } else {
                    throw sendError;
                }
            }
        }
        
        dc.send(JSON.stringify({ type: 'end' }));
        if (sendBtn) sendBtn.innerHTML = `<i class='fa-solid fa-spinner fa-spin'></i> Saving ${currentFileIndex + 1}/${fileQueue.length}...`;
        isSending = false; 
    } catch (err) {
        isSending = false;
        console.error('Send error:', err);
    }
}

function moveToNextFile() {
    currentFileIndex++;
    if (currentFileIndex < fileQueue.length) {
        selectedFile = fileQueue[currentFileIndex];
        if (dataChannel && dataChannel.readyState === 'open') {
            dataChannel.send(JSON.stringify({
                type: 'metadata',
                name: selectedFile.name,
                size: selectedFile.size,
                uiName: `Receiving item ${currentFileIndex + 1} of ${fileQueue.length}...`,
                uiSize: selectedFile.size,
                totalFiles: fileQueue.length
            }));
        }
    } else {
        if (dataChannel && dataChannel.readyState === 'open') {
            dataChannel.send(JSON.stringify({ type: 'all-complete' }));
        }
        // 👇 YAHAN STOP CODE JODEIN 👇
        window.isTransferActive = false;
        if(document.getElementById('transferWarning')) document.getElementById('transferWarning').style.display = 'none';
        // 👆 ---------------------- 👆
        if (sendBtn) {
            sendBtn.innerHTML = "<i class='fas fa-check'></i> All Sent Successfully!";
            sendBtn.style.background = "#22c55e";
            sendBtn.style.color = "white";
        }
        triggerCelebration();
    }
}
// 🔥 APPLE STYLE SUBTLE HAPTIC FEEDBACK
function triggerPremiumHaptic() {
    if (navigator.vibrate) {
        // 12ms ka ultra-short vibration jo liquid pop jaisa feel deta hai
        navigator.vibrate(12); 
    }
}

// App ke sabhi clickable buttons aur zones par automatic haptic lagaao
document.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('.theme-btn') || e.target.closest('#drop-zone') || e.target.closest('.action-circle')) {
        triggerPremiumHaptic();
    }
});


// 🔥 CUSTOM PREMIUM GLASS POPUP (Auto Dark/Light Theme Aware)
function showPremiumAlert() {
    
    // 🧠 Smart Theme Detector
    const isLightMode = document.body.classList.contains('light-mode') || 
                        document.body.classList.contains('light') || 
                        window.getComputedStyle(document.body).color === 'rgb(0, 0, 0)' ||
                        (document.getElementById('theme-toggle') && document.getElementById('theme-toggle').innerText.includes('Dark'));

    // 🎨 Glassmorphism Colors set karna
    // Light mode mein background transparency 0.45 se badhakar 0.75 kar di hai taaki text ubhar kar aaye
    const glassBg = isLightMode ? "rgba(255, 255, 255, 0.75)" : "rgba(30, 41, 59, 0.55)";
    const glassBorder = isLightMode ? "rgba(255, 255, 255, 0.8)" : "rgba(255, 255, 255, 0.1)";
    
    // Text ko ekdum dark kar diya hai padhne mein aasan karne ke liye
    const textColor = isLightMode ? "#000000" : "#ffffff"; 
    const subTextColor = isLightMode ? "#333333" : "#94a3b8"; 
    
    const innerBoxBg = isLightMode ? "rgba(0, 0, 0, 0.06)" : "rgba(0, 0, 0, 0.2)";
    const overlayBg = isLightMode ? "rgba(0, 0, 0, 0.3)" : "rgba(0, 0, 0, 0.6)";

    // 1. Pichhe ka Overlay 
    const overlay = document.createElement('div');
    overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: ${overlayBg}; z-index: 99999; display: flex; justify-content: center; align-items: center; backdrop-filter: blur(6px); transition: opacity 0.3s ease;`;

    // 2. Main Glass Popup Box
    const popup = document.createElement('div');
    popup.style.cssText = `
        background: ${glassBg};
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid ${glassBorder};
        padding: 30px 25px;
        border-radius: 20px;
        width: 85%;
        max-width: 380px;
        text-align: center;
        box-shadow: 0 25px 50px rgba(0,0,0,0.2);
        transform: scale(0.8);
        animation: glassPopIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
    `;

    // 3. Popup ke andar ka Content
    popup.innerHTML = `
        <style>
            @keyframes glassPopIn { to { transform: scale(1); } }
        </style>
        <div style="font-size: 55px; color: #22c55e; margin-bottom: 15px; filter: drop-shadow(0 4px 10px rgba(34,197,94,0.4));">
            <i class="fas fa-check-circle"></i>
        </div>
        <h2 style="margin: 0 0 10px; color: ${textColor}; font-size: 24px; font-weight: 800; font-family: sans-serif; letter-spacing: -0.5px;">Transfer Complete</h2>
        <p style="margin: 0 0 25px; color: ${subTextColor}; font-size: 14px; line-height: 1.6; font-family: sans-serif;">
            Your files are safely stored on your device.<br><br>
            <span style="background: ${innerBoxBg}; padding: 8px 14px; border-radius: 10px; font-size: 13px; font-weight: 600; color: ${textColor}; border: 1px solid ${glassBorder}; display: inline-block; box-shadow: inset 0 2px 5px rgba(0,0,0,0.05);">
                📁 Location: Your Selected Folder
            </span>
        </p>
        <button id="premium-btn" style="background: #facc15; color: #000000; border: none; padding: 15px 24px; font-size: 16px; font-weight: bold; border-radius: 12px; cursor: pointer; width: 100%; box-shadow: 0 8px 20px rgba(250, 204, 21, 0.3); transition: transform 0.1s ease;">
            Got it
        </button>
    `;

    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    // 4. Button Par Click Effect
    const btn = document.getElementById('premium-btn');
    btn.addEventListener('mousedown', () => btn.style.transform = 'scale(0.95)');
    btn.addEventListener('mouseup', () => btn.style.transform = 'scale(1)');
    
    btn.addEventListener('click', () => {
        if (typeof triggerPremiumHaptic === 'function') triggerPremiumHaptic();
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 300);
    });
}

// --- CHAT SYSTEM LOGIC ---
let unreadCount = 0; // Unread message ginne ke liye

// 1. Chat Open/Close (Tick update logic)
function toggleChat() {
    const popup = document.getElementById('chat-popup');
    popup.classList.toggle('hidden');
    
    if(!popup.classList.contains('hidden')) {
        document.getElementById('chat-input').focus();
        
        // Badge ko 0 karo aur chupao
        unreadCount = 0;
        document.getElementById('chat-badge').classList.add('hidden');

        // Samne wale ko batao ki maine chat padh li hai
        if (dataChannel && dataChannel.readyState === 'open') {
            dataChannel.send(JSON.stringify({ type: 'chat-read' }));
        }
    }
}

// 2 & 3. Haptic Vibration, Enter Key & Keyboard Auto-Scroll Fix
window.addEventListener('load', () => {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        // Typing par haptic vibration
        chatInput.addEventListener('input', () => {
            if (navigator.vibrate) navigator.vibrate(5);
        });
        
        // Enter dabane par message send
        chatInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') sendChatMessage();
        });

        // NAYA CODE: Keyboard khulte hi chat ko automatically niche dhakelna
        chatInput.addEventListener('focus', () => {
            setTimeout(() => {
                const chatBody = document.getElementById('chat-messages');
                if (chatBody) {
                    chatBody.scrollTop = chatBody.scrollHeight;
                }
            }, 300); // 300ms ka wait taaki keyboard poora khul jaye
        });
    }
});

// 4. Message Bhejna (Single Tick)
function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (text === '') return;
    
    if (!dataChannel || dataChannel.readyState !== 'open') {
        alert("Wait for the other user to connect first!");
        return;
    }

    dataChannel.send(JSON.stringify({ type: 'chat-message', content: text }));
    appendMessage(text, 'sent'); 
    
    input.value = '';
    if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
}

// 5. Message Screen Par Dikhana (Ticks Logic)
function appendMessage(text, type) {
    const chatBody = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg-bubble ${type === 'sent' ? 'msg-sent' : 'msg-received'}`;
    
    // Single tick: Ekdum perfect WhatsApp jaisa Soft Grey (#888888)
    const ticks = type === 'sent' ? `<span class="msg-ticks unread-tick" style="color: #888888 !important; font-size: 14px; margin-left: 5px; font-weight: bold;">✓</span>` : '';
    
    msgDiv.innerHTML = `${text} ${ticks}`;
    chatBody.appendChild(msgDiv);
    chatBody.scrollTop = chatBody.scrollHeight;
}