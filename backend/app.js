// app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const db = require('./db');
const notaRoutes = require('./notaRoutes');

const app = express();
const server = http.createServer(app);

// --------- CORS ---------
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'https://recepcaopneuforte-1.onrender.com', // FRONTEND (Render)
];

const ORIGINS =
  (process.env.FRONTEND_ORIGIN || process.env.CORS_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const allowedOrigins = ORIGINS.length ? ORIGINS : DEFAULT_ORIGINS;

const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // responde preflight
app.use(express.json());

// --------- Socket.IO ---------
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET','POST'], credentials: true }
});

io.on('connection', (socket) => {
  console.log('🟢 Novo cliente conectado via WebSocket');
  socket.on('disconnect', () => console.log('🔴 Cliente desconectado'));
});
app.set('io', io);

// --------- Rotas ---------
app.use('/api', notaRoutes);

// Healthcheck
app.get('/api/health', async (_req, res) => {
  try {
    const rows = await db.query('SELECT 1 AS ok');
    res.json({ up: true, db: true, rows });
  } catch (e) {
    res.status(500).json({ up: true, db: false, detail: e.code || e.message });
  }
});

// --------- Start ---------
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`🚀 Servidor rodando em http://${HOST}:${PORT}`);
});

server.on('error', (e) => console.error('listen error', e));