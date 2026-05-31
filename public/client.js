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
                    newItem.style.cssText = "display: flex; justify-content: space-between; padding: 10px; background: rgba(255,255,255,0.05); margin-bottom: 5px; border-radius: 5px; border-left: 4px solid #22c55e;";
                    newItem.innerHTML = `<div><i class="fas fa-file-download" style="color:#22c55e; margin-right: 10px;"></i> <span style="color:#fff;">${incomingFileInfo.name}</span></div><div style="color: #94a3b8;">${sizeMB} MB</div>`;
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