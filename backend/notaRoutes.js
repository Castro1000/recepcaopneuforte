// notaRoutes.js
const express = require('express');
const router = express.Router();
const db = require('./db');
const jwt = require('jsonwebtoken');

// Fuso horário Manaus
db.query("SET time_zone = '-04:00'");

// ---------------- LOGIN ----------------
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
      return res.json({ token, tipo: user.tipo, nome: user.name });
    } else {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }
  });
});

// -------- CADASTRAR CARRO (com servico2, servico3 e num_movimento) --------
router.post('/cadastrar-carro', (req, res) => {
  const {
    placa,
    modelo,
    cor,
    servico,
    servico2,
    servico3,
    num_movimento,
  } = req.body;

  // validações mínimas no backend também
  if (!placa || !modelo || !cor || !servico || !num_movimento) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

  const sql = `
    INSERT INTO carros
      (placa, modelo, cor, servico, servico2, servico3, num_movimento, data_entrada)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, NOW())
  `;

  const values = [
    placa.toUpperCase(),
    modelo.toUpperCase(),
    cor.toUpperCase(),
    servico ? servico.toUpperCase() : null,
    servico2 ? servico2.toUpperCase() : null,
    servico3 ? servico3.toUpperCase() : null,
    num_movimento, // não forço upper aqui; se for alfanumérico, ok.
  ];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error('Erro ao cadastrar carro:', err);
      return res.status(500).json({ error: 'Erro ao cadastrar carro' });
    }

    // Notificar painel via socket (se houver)
    const io = req.app.get('io');
    if (io) io.emit('novoCarroAdicionado');

    return res.status(200).json({
      message: 'Carro cadastrado com sucesso',
      id: result.insertId,
    });
  });
});

// ---------------- LISTAR FILA ----------------
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

// --------- FINALIZAR (emite socket com dados do carro) ---------
router.put('/finalizar-carro/:id', (req, res) => {
  const { id } = req.params;

  const updateSql = 'UPDATE carros SET data_saida = NOW() WHERE id = ?';
  db.query(updateSql, [id], (err) => {
    if (err) {
      console.error('Erro ao finalizar atendimento:', err);
      return res.status(500).json({ error: 'Erro ao finalizar atendimento' });
    }

    const selectSql = 'SELECT * FROM carros WHERE id = ?';
    db.query(selectSql, [id], (err2, rows) => {
      if (err2 || rows.length === 0) {
        console.error('Erro ao buscar carro finalizado:', err2);
        return res.status(500).json({ error: 'Erro ao buscar dados do carro finalizado' });
      }

      const carroFinalizado = rows[0];

      const io = req.app.get('io');
      if (io) io.emit('carroFinalizado', carroFinalizado);

      return res.status(200).json({
        message: 'Atendimento finalizado com sucesso',
        carro: carroFinalizado
      });
    });
  });
});

module.exports = router;
