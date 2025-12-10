declare const io: any;

interface PeerConnection {
  pc: RTCPeerConnection;
  participantId: string;
}

class VideoCallApp {
  private socket: any;
  private localStream: MediaStream | null = null;
  private peerConnections = new Map<string, PeerConnection>();
  private participantId: string;
  private roomId: string;
  private encryptionKey: string = 'my-secure-encryption-key-2024';
  private encryptionWorker: Worker | null = null;

  constructor() {
    this.participantId = this.generateId();
    this.roomId = this.getRoomIdFromUrl() || 'default-room';
    this.socket = io();
    
    this.initializeEncryptionWorker();
    this.setupSocketListeners();
    this.setupUI();
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private getRoomIdFromUrl(): string | null {
    const params = new URLSearchParams(window.location.search);
    return params.get('room');
  }

  private initializeEncryptionWorker(): void {
    try {
      // Create the encryption worker
      this.encryptionWorker = new Worker('encryption-worker.js');
      this.encryptionWorker.postMessage({ type: 'init' });
      console.log('Encryption worker initialized');
    } catch (error) {
      console.error('Failed to initialize encryption worker:', error);
    }
  }

  private setupSocketListeners(): void {
    this.socket.on('connect', () => {
      console.log('Connected to signaling server');
    });

    this.socket.on('room-joined', async (data: { participantId: string; participants: string[] }) => {
      console.log('Joined room, existing participants:', data.participants);
      
      // Create peer connections for existing participants
      for (const participantId of data.participants) {
        await this.createPeerConnection(participantId, true);
      }
    });

    this.socket.on('user-joined', async (data: { participantId: string }) => {
      console.log('New user joined:', data.participantId);
      // Wait for offer from the new user
    });

    this.socket.on('offer', async (data: { from: string; offer: RTCSessionDescriptionInit }) => {
      console.log('Received offer from:', data.from);
      await this.handleOffer(data.from, data.offer);
    });

    this.socket.on('answer', async (data: { from: string; answer: RTCSessionDescriptionInit }) => {
      console.log('Received answer from:', data.from);
      await this.handleAnswer(data.from, data.answer);
    });

    this.socket.on('ice-candidate', async (data: { from: string; candidate: RTCIceCandidateInit }) => {
      console.log('Received ICE candidate from:', data.from);
      await this.handleIceCandidate(data.from, data.candidate);
    });

    this.socket.on('user-left', (data: { participantId: string }) => {
      console.log('User left:', data.participantId);
      this.removePeerConnection(data.participantId);
    });
  }

  private setupUI(): void {
    const joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
    const leaveBtn = document.getElementById('leave-btn') as HTMLButtonElement;
    const roomInput = document.getElementById('room-input') as HTMLInputElement;
    const roomInfo = document.getElementById('room-info') as HTMLDivElement;

    if (this.roomId) {
      roomInput.value = this.roomId;
    }

    joinBtn.addEventListener('click', async () => {
      const room = roomInput.value.trim() || 'default-room';
      this.roomId = room;
      await this.joinRoom();
      
      joinBtn.style.display = 'none';
      leaveBtn.style.display = 'inline-block';
      roomInput.disabled = true;
      roomInfo.textContent = `Room: ${this.roomId} | Participant: ${this.participantId}`;
    });

    leaveBtn.addEventListener('click', () => {
      this.leaveRoom();
      joinBtn.style.display = 'inline-block';
      leaveBtn.style.display = 'none';
      roomInput.disabled = false;
      roomInfo.textContent = '';
    });

    // Auto-join if room is in URL
    if (this.roomId) {
      this.joinRoom();
      joinBtn.style.display = 'none';
      leaveBtn.style.display = 'inline-block';
      roomInput.disabled = true;
      roomInfo.textContent = `Room: ${this.roomId} | Participant: ${this.participantId}`;
    }
  }

  private async joinRoom(): Promise<void> {
    try {
      // Get local media stream
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true
      });

      // Display local video
      const localVideo = document.getElementById('local-video') as HTMLVideoElement;
      localVideo.srcObject = this.localStream;

      // Join room via signaling server
      this.socket.emit('join-room', {
        roomId: this.roomId,
        participantId: this.participantId
      });

      console.log('Joined room:', this.roomId);
    } catch (error) {
      console.error('Error joining room:', error);
      alert('Failed to access camera/microphone. Please grant permissions and try again.');
    }
  }

  private async createPeerConnection(participantId: string, createOffer: boolean): Promise<void> {
    const configuration: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    const pc = new RTCPeerConnection(configuration);

    // Add local tracks to peer connection
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream!);
      });
    }

    // Add encryption transform to sender
    if (this.encryptionWorker) {
      const senders = pc.getSenders();
      senders.forEach(sender => {
        if (sender.track) {
          try {
            const transform = new RTCRtpScriptTransform(
              this.encryptionWorker!,
              { 
                operation: 'encrypt',
                encryptionKey: this.encryptionKey
              }
            );
            sender.transform = transform;
            console.log('Encryption transform added to sender');
          } catch (error) {
            console.error('Failed to add encryption transform to sender:', error);
          }
        }
      });
    }

    // Handle incoming tracks
    pc.ontrack = (event) => {
      console.log('Received remote track from:', participantId);
      this.addRemoteVideo(participantId, event.streams[0]);
    };

    // Add encryption transform to receiver
    pc.ontrack = (event) => {
      if (this.encryptionWorker && event.receiver) {
        try {
          const transform = new RTCRtpScriptTransform(
            this.encryptionWorker,
            { 
              operation: 'decrypt',
              encryptionKey: this.encryptionKey
            }
          );
          event.receiver.transform = transform;
          console.log('Decryption transform added to receiver');
        } catch (error) {
          console.error('Failed to add decryption transform to receiver:', error);
        }
      }
      
      console.log('Received remote track from:', participantId);
      this.addRemoteVideo(participantId, event.streams[0]);
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('ice-candidate', {
          to: participantId,
          candidate: event.candidate.toJSON(),
          from: this.participantId
        });
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${participantId}:`, pc.connectionState);
    };

    this.peerConnections.set(participantId, { pc, participantId });

    // Create and send offer if this is the initiator
    if (createOffer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      this.socket.emit('offer', {
        to: participantId,
        offer: pc.localDescription!.toJSON(),
        from: this.participantId
      });
    }
  }

  private async handleOffer(from: string, offer: RTCSessionDescriptionInit): Promise<void> {
    // Create peer connection if it doesn't exist
    if (!this.peerConnections.has(from)) {
      await this.createPeerConnection(from, false);
    }

    const peerConnection = this.peerConnections.get(from);
    if (!peerConnection) return;

    await peerConnection.pc.setRemoteDescription(new RTCSessionDescription(offer));
    
    const answer = await peerConnection.pc.createAnswer();
    await peerConnection.pc.setLocalDescription(answer);

    this.socket.emit('answer', {
      to: from,
      answer: peerConnection.pc.localDescription!.toJSON(),
      from: this.participantId
    });
  }

  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const peerConnection = this.peerConnections.get(from);
    if (!peerConnection) return;

    await peerConnection.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  private async handleIceCandidate(from: string, candidate: RTCIceCandidateInit): Promise<void> {
    const peerConnection = this.peerConnections.get(from);
    if (!peerConnection) return;

    await peerConnection.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  private addRemoteVideo(participantId: string, stream: MediaStream): void {
    const videoGrid = document.getElementById('video-grid') as HTMLDivElement;
    
    // Remove existing video if any
    const existingContainer = document.getElementById(`video-container-${participantId}`);
    if (existingContainer) {
      existingContainer.remove();
    }

    // Create new video container
    const videoContainer = document.createElement('div');
    videoContainer.id = `video-container-${participantId}`;
    videoContainer.className = 'video-container';

    const video = document.createElement('video');
    video.id = `video-${participantId}`;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;

    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = `Participant ${participantId.substring(0, 6)}`;

    videoContainer.appendChild(video);
    videoContainer.appendChild(label);
    videoGrid.appendChild(videoContainer);
  }

  private removePeerConnection(participantId: string): void {
    const peerConnection = this.peerConnections.get(participantId);
    if (peerConnection) {
      peerConnection.pc.close();
      this.peerConnections.delete(participantId);
    }

    // Remove video element
    const videoContainer = document.getElementById(`video-container-${participantId}`);
    if (videoContainer) {
      videoContainer.remove();
    }
  }

  private leaveRoom(): void {
    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    // Close all peer connections
    this.peerConnections.forEach(({ pc }) => pc.close());
    this.peerConnections.clear();

    // Clear remote videos
    const videoGrid = document.getElementById('video-grid') as HTMLDivElement;
    videoGrid.innerHTML = '';

    // Clear local video
    const localVideo = document.getElementById('local-video') as HTMLVideoElement;
    localVideo.srcObject = null;

    // Disconnect socket
    this.socket.disconnect();
    this.socket.connect();
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new VideoCallApp();
});
