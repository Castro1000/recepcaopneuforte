const express = require('express');
const router = express.Router();
const db = require('./db');
const jwt = require('jsonwebtoken');

// Define o fuso horário de Manaus
db.query("SET time_zone = '-04:00'");

// LOGIN
router.post('/login', (req, res) => {
  const { usuario, senha } = req.body;

  const sql = 'SELECT * FROM usuarios WHERE usuario = ? AND senha = ?';
  db.query(sql, [usuario, senha], (err, results) => {
    if (err) {
      console.error('Erro no login:', err);
      return res.status(500).json({ error: 'Erro no servidor' });
    }

    if (results.length > 0) {
      const user = results[0];

      const token = jwt.sign(
        { id: user.id, usuario: user.usuario, tipo: user.tipo },
        'seuSegredo',
        { expiresIn: '1h' }
      );

      return res.json({
        token,
        tipo: user.tipo,
        nome: user.name
      });
    } else {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }
  });
});

// CADASTRAR CARRO + EMITIR EVENTO SOCKET.IO
router.post('/cadastrar-carro', (req, res) => {
  const { placa, modelo, cor, servico } = req.body;

  if (!placa || !modelo || !cor || !servico) {
    return res.status(400).json({ error: 'Preencha todos os campos obrigatórios' });
  }

  const sql = 'INSERT INTO carros (placa, modelo, cor, servico, data_entrada) VALUES (?, ?, ?, ?, NOW())';
  db.query(sql, [placa.toUpperCase(), modelo.toUpperCase(), cor.toUpperCase(), servico.toUpperCase()], (err, result) => {
    if (err) {
      console.error('Erro ao cadastrar carro:', err);
      return res.status(500).json({ error: 'Erro ao cadastrar carro' });
    }

    // EMITIR EVENTO SOCKET.IO PARA O PAINEL
    const io = req.app.get('io');
    io.emit('novoCarroAdicionado');

    return res.status(200).json({ message: 'Carro cadastrado com sucesso' });
  });
});

// LISTAR FILA
router.get('/fila-servico', (req, res) => {
  const sql = 'SELECT * FROM carros WHERE data_saida IS NULL ORDER BY data_entrada DESC';
  db.query(sql, (err, results) => {
    if (err) {
      console.error('Erro ao buscar carros:', err);
      return res.status(500).json({ error: 'Erro ao buscar carros' });
    }

    return res.status(200).json(results);
  });
});

// FINALIZAR CARRO COM EVENTO SOCKET
router.put('/finalizar-carro/:id', (req, res) => {
  const { id } = req.params;

  const updateSql = 'UPDATE carros SET data_saida = NOW() WHERE id = ?';
  db.query(updateSql, [id], (err, result) => {
    if (err) {
      console.error('Erro ao finalizar atendimento:', err);
      return res.status(500).json({ error: 'Erro ao finalizar atendimento' });
    }

    // Buscar os dados do carro finalizado
    const selectSql = 'SELECT * FROM carros WHERE id = ?';
    db.query(selectSql, [id], (err, rows) => {
      if (err || rows.length === 0) {
        console.error('Erro ao buscar carro finalizado:', err);
        return res.status(500).json({ error: 'Erro ao buscar dados do carro finalizado' });
      }

      const carroFinalizado = rows[0];

      // Emitir evento via socket.io
      const io = req.app.get('io');
      io.emit('carroFinalizado', carroFinalizado);

      return res.status(200).json({ message: 'Atendimento finalizado com sucesso', carro: carroFinalizado });
    });
  });
});

module.exports = router;
