const express = require('express');
// Add CORS middleware for Express
const cors = require('cors');

const app = express();

// Add CORS middleware
app.use(cors({
  origin: ["http://127.0.0.1:5500", "http://localhost:5500", "https://club-3d.vercel.app/"],
  methods: ["GET", "POST"],
  credentials: true
}));

const http = require('http').Server(app);
const io = require('socket.io')(http, {
  cors: {
    origin: ["http://127.0.0.1:5500", "http://localhost:5500", "https://club-3d.vercel.app/"],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

// Store connected players and rooms
const players = new Map();
const rooms = new Map();

// Environment state management
const environmentState = {
  lights: {
    light1: 1,
    light2: 1,
    tube: 1
  },
  shaders: {},
  audioMode: 'default'
};

// Position update rate limiting
const POSITION_UPDATE_RATE = 16; // ~60fps
let lastUpdate = {};

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Send initial state to new connections
  socket.emit('initialState', {
    environment: environmentState,
    players: Array.from(players.values())
  });

  // Handle username setting
  socket.on('set username', (username) => {
    players.set(socket.id, {
      id: socket.id,
      username: username,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      shaderIndex: 0,
      action: 'Idle'
    });

    // Broadcast new player to all other players
    socket.broadcast.emit('newPlayer', {
      id: socket.id,
      username: username
    });

    // Send existing players to new player
    const existingPlayers = Array.from(players.values());
    socket.emit('existingPlayers', existingPlayers);
  });

  // Handle room management
  socket.on('joinRoom', (roomId) => {
    socket.join(roomId);
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.id);

    const roomPlayers = Array.from(rooms.get(roomId))
      .map(playerId => players.get(playerId))
      .filter(player => player);

    socket.emit('roomState', {
      players: roomPlayers
    });
  });

  // Handle player position updates with rate limiting
  socket.on('playerMove', (data) => {
    const now = Date.now();
    if (!lastUpdate[socket.id] || now - lastUpdate[socket.id] >= POSITION_UPDATE_RATE) {
      const player = players.get(socket.id);
      if (player) {
        player.position = data.position;
        player.rotation = data.rotation;
        player.action = data.action;
        socket.broadcast.emit('playerMoved', {
          id: socket.id,
          position: data.position,
          rotation: data.rotation,
          action: data.action
        });
        lastUpdate[socket.id] = now;
      }
    }
  });

  // Handle shader updates
  socket.on('get shaders', (shaderIndex) => {
    const player = players.get(socket.id);
    if (player) {
      player.shaderIndex = shaderIndex;
      socket.broadcast.emit('shader update', {
        id: socket.id,
        shaderIndex: shaderIndex
      });
    }
  });

  // Handle appearance updates
  socket.on('appearanceUpdate', (data) => {
    const player = players.get(socket.id);
    if (player) {
      player.appearance = data;
      socket.broadcast.emit('playerAppearanceChanged', {
        id: socket.id,
        appearance: data
      });
    }
  });

  // Handle animation updates
  socket.on('animationUpdate', (data) => {
    const player = players.get(socket.id);
    if (player) {
      player.animation = data;
      socket.broadcast.emit('playerAnimationChanged', {
        id: socket.id,
        animation: data
      });
    }
  });

  // Handle audio sync
  socket.on('audioSync', (data) => {
    const roomId = Array.from(socket.rooms)[1]; // Get current room
    if (roomId) {
      socket.to(roomId).emit('audioSync', {
        timestamp: data.timestamp,
        playing: data.playing,
        songId: data.songId
      });
    }
  });

  // Handle environment updates
  socket.on('environmentUpdate', (data) => {
    Object.assign(environmentState, data);
    socket.broadcast.emit('environmentUpdated', environmentState);
  });

  // Handle chat messages
  socket.on('chat message', (data) => {
    // Check if data is an object with message property
    const messageText = data.message || data;
    const username = players.get(socket.id)?.username || 'Unknown';

    io.emit('chat message', {
      id: socket.id,
      name: username,  // Changed from username to name to match frontend
      message: messageText
    });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    // Remove player from any rooms they were in
    rooms.forEach((players, roomId) => {
      players.delete(socket.id);
      if (players.size === 0) {
        rooms.delete(roomId);
      }
    });

    // Remove player from players map
    players.delete(socket.id);

    // Notify other players
    io.emit('deletePlayer', { id: socket.id });

    // Clean up rate limiting data
    delete lastUpdate[socket.id];
  });
});

// Start server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
