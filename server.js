const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

io.on('connection', (socket) => {
    console.log('Naya user connect hua:', socket.id);

    // User specific room mein join karega (Isi se hazaron log ek sath use kar payenge)
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        console.log(`User ${socket.id} ne room join kiya: ${roomId}`);
        // Client ke aate hi Sender ko signal bhejo
        socket.to(roomId).emit('client-joined'); 
    });

    socket.on('offer', (data) => {
        socket.to(data.room).emit('offer', data.offer);
    });

    socket.on('answer', (data) => {
        socket.to(data.room).emit('answer', data.answer);
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.room).emit('ice-candidate', data.candidate);
    });

    socket.on('disconnect', () => {
        console.log('User disconnect ho gaya:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server Ready on port ${PORT}`);
});