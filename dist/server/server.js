"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const path_1 = __importDefault(require("path"));
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
// Serve static files
app.use(express_1.default.static(path_1.default.join(__dirname, '../client')));
const rooms = new Map();
const participants = new Map();
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('join-room', (data) => {
        const { roomId, participantId } = data;
        // Create room if it doesn't exist
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                id: roomId,
                participants: new Set()
            });
        }
        const room = rooms.get(roomId);
        room.participants.add(participantId);
        participants.set(participantId, {
            id: participantId,
            socketId: socket.id,
            roomId
        });
        socket.join(roomId);
        // Notify others in the room
        socket.to(roomId).emit('user-joined', {
            participantId,
            participants: Array.from(room.participants)
        });
        // Send existing participants to the new user
        socket.emit('room-joined', {
            participantId,
            participants: Array.from(room.participants).filter(p => p !== participantId)
        });
        console.log(`Participant ${participantId} joined room ${roomId}`);
    });
    socket.on('offer', (data) => {
        const toParticipant = participants.get(data.to);
        if (toParticipant) {
            io.to(toParticipant.socketId).emit('offer', {
                from: data.from,
                offer: data.offer
            });
        }
    });
    socket.on('answer', (data) => {
        const toParticipant = participants.get(data.to);
        if (toParticipant) {
            io.to(toParticipant.socketId).emit('answer', {
                from: data.from,
                answer: data.answer
            });
        }
    });
    socket.on('ice-candidate', (data) => {
        const toParticipant = participants.get(data.to);
        if (toParticipant) {
            io.to(toParticipant.socketId).emit('ice-candidate', {
                from: data.from,
                candidate: data.candidate
            });
        }
    });
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        // Find and remove participant
        for (const [participantId, participant] of participants.entries()) {
            if (participant.socketId === socket.id) {
                const room = rooms.get(participant.roomId);
                if (room) {
                    room.participants.delete(participantId);
                    // Notify others in the room
                    socket.to(participant.roomId).emit('user-left', { participantId });
                    // Clean up empty rooms
                    if (room.participants.size === 0) {
                        rooms.delete(participant.roomId);
                    }
                }
                participants.delete(participantId);
                break;
            }
        }
    });
});
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`SFU Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser`);
});
