import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, '../client')));

interface Room {
  id: string;
  participants: Set<string>;
}

interface Participant {
  id: string;
  socketId: string;
  roomId: string;
}

const rooms = new Map<string, Room>();
const participants = new Map<string, Participant>();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-room', (data: { roomId: string; participantId: string }) => {
    const { roomId, participantId } = data;
    
    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId,
        participants: new Set()
      });
    }

    const room = rooms.get(roomId)!;
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

  socket.on('offer', (data: { to: string; offer: RTCSessionDescriptionInit; from: string }) => {
    const toParticipant = participants.get(data.to);
    if (toParticipant) {
      io.to(toParticipant.socketId).emit('offer', {
        from: data.from,
        offer: data.offer
      });
    }
  });

  socket.on('answer', (data: { to: string; answer: RTCSessionDescriptionInit; from: string }) => {
    const toParticipant = participants.get(data.to);
    if (toParticipant) {
      io.to(toParticipant.socketId).emit('answer', {
        from: data.from,
        answer: data.answer
      });
    }
  });

  socket.on('ice-candidate', (data: { to: string; candidate: RTCIceCandidateInit; from: string }) => {
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
