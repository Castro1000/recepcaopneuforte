// app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const db = require('./db');
const notaRoutes = require('./notaRoutes');

const app = express();
const server = http.createServer(app);

// ---------- Trust proxy (Render/Heroku/NGINX) ----------
app.set('trust proxy', 1);

// ---------- CORS ----------
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',      // vite preview
  'http://127.0.0.1:4173',      // vite preview
  'https://recepcaopneuforte.onrender.com',
  'https://recepcaopneuforte-1.onrender.com',
];

const ORIGINS = (process.env.FRONTEND_ORIGIN || process.env.CORS_ORIGIN || '')
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
app.options('*', cors(corsOptions));


// ---------- Body parsers ----------
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// ---------- Static de uploads ----------
const UPLOADS_ROOT = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_ROOT, { recursive: true });
app.use('/uploads', express.static(UPLOADS_ROOT, { maxAge: '7d' }));

// ---------- Socket.IO ----------
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true }
});

io.on('connection', (socket) => {
  console.log('🟢 Novo cliente conectado via WebSocket');
  socket.on('disconnect', () => console.log('🔴 Cliente desconectado'));
});
app.set('io', io);

// ---------- Rotas ----------
app.use('/api', notaRoutes);

// Healthcheck (compatível com mysql callback)
app.get('/api/health', (_req, res) => {
  db.query('SELECT 1 AS ok', (err, rows) => {
    if (err) {
      return res.status(500).json({ up: true, db: false, detail: err.code || err.message });
    }
    res.json({ up: true, db: true, rows });
  });
});

// Raiz opcional (útil para ver se subiu)
app.get('/', (_req, res) => {
  res.type('text/plain').send('Recepcao Pneu Forte API up. Use /api/*');
});

// ---------- Start ----------
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`🚀 Servidor rodando em http://${HOST}:${PORT}`);
  console.log('CORS allowed:', allowedOrigins.join(', '));
});

server.on('error', (e) => console.error('listen error', e));
