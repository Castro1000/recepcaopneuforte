// app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const db = require('./db');              // seu db.js (pool)
const notaRoutes = require('./notaRoutes');

const app = express();
const server = http.createServer(app);

// ---------- CORS ----------
const ORIGINS =
  (process.env.FRONTEND_ORIGIN || process.env.CORS_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

// Se não configurar no .env, libera geral (útil pra testes locais)
const corsOptions = {
  origin: ORIGINS.length ? ORIGINS : true,
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());

// ---------- Socket.IO ----------
const io = new Server(server, {
  cors: {
    origin: ORIGINS.length ? ORIGINS : true,
    methods: ['GET', 'POST'],
    credentials: true,
  }
});

io.on('connection', (socket) => {
  console.log('🟢 Novo cliente conectado via WebSocket');
  socket.on('disconnect', () => console.log('🔴 Cliente desconectado'));
});

// Disponibiliza o io nas rotas
app.set('io', io);

// ---------- Rotas ----------
app.use('/api', notaRoutes);

// Healthcheck (servidor + banco)
app.get('/api/health', async (req, res) => {
  try {
    const rows = await db.query('SELECT 1 AS ok');
    res.json({ up: true, db: true, rows });
  } catch (e) {
    res.status(500).json({ up: true, db: false, detail: e.code || e.message });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0'; // importante para acesso externo/local

server.listen(PORT, HOST, () => {
  console.log(`🚀 Servidor rodando em http://${HOST}:${PORT}`);
});

server.on('error', (e) => console.error('listen error', e));

// (opcional) servir o build do frontend por aqui se quiser:
// const path = require('path');
// const distPath = path.join(__dirname, '../frontend/dist');
// app.use(express.static(distPath));
// app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
