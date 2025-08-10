const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app); // Cria o servidor HTTP com suporte a socket.io

const io = new Server(server, {
  cors: {
    origin: '*', // Permite qualquer origem (ajuste se necessário)
    methods: ['GET', 'POST']
  }
});

// Evento quando um cliente conecta via socket
io.on('connection', (socket) => {
  console.log('🟢 Novo cliente conectado via WebSocket');

  socket.on('disconnect', () => {
    console.log('🔴 Cliente desconectado');
  });
});

// Middleware
app.use(cors());
app.use(express.json());

// Rotas
const notaRoutes = require('./notaRoutes');
app.use('/api', notaRoutes);

// Exporta io para usar em outras rotas
app.set('io', io);

// Inicia servidor
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
