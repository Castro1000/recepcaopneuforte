// notaRoutes.js
const express = require('express');
const router = express.Router();
const db = require('./db');
const jwt = require('jsonwebtoken');

// Ajusta fuso horário da sessão MySQL (Manaus -04:00)
db.query("SET time_zone = '-04:00'", (err) => {
  if (err) console.error('Falha ao definir time_zone:', err);
});

// ---------------- LOGIN ----------------
router.post('/login', (req, res) => {
  const { usuario, senha } = req.body;

  const sql = 'SELECT * FROM usuarios WHERE usuario = ? AND senha = ?';
  db.query(sql, [usuario, senha], (err, results) => {
    if (err) {
      console.error('Erro no login:', err);
      return res.status(500).json({ error: 'Erro no servidor' });
    }

    if (results && results.length > 0) {
      const user = results[0];
      const token = jwt.sign(
        { id: user.id, usuario: user.usuario, tipo: user.tipo },
        process.env.JWT_SECRET || 'seuSegredo',
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

  // validações mínimas também no backend
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
    String(placa).toUpperCase().slice(0, 7), // placa máx 7
    String(modelo).toUpperCase(),
    String(cor).toUpperCase(),
    servico  ? String(servico).toUpperCase()  : null,
    servico2 ? String(servico2).toUpperCase() : null,
    servico3 ? String(servico3).toUpperCase() : null,
    String(num_movimento).trim(),
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
  const sql = `
    SELECT id, placa, modelo, cor, servico, servico2, servico3, num_movimento, data_entrada
    FROM carros
    WHERE data_saida IS NULL
    ORDER BY data_entrada DESC
  `;
  db.query(sql, (err, results) => {
    if (err) {
      console.error('Erro ao buscar carros:', err);
      return res.status(500).json({ error: 'Erro ao buscar carros' });
    }
    return res.status(200).json(results || []);
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
      if (err2 || !rows || rows.length === 0) {
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

// --------- MÉDIAS POR SERVIÇO (histórico finalizado) ---------
// Retorna { byService: {SERVICO: minutos}, global: minutos }
router.get('/medias-servicos', (req, res) => {
  // Unpivot servico/servico2/servico3 e calcula média em minutos (apenas finalizados)
  const sqlByService = `
    SELECT nome AS servico,
           AVG(TIMESTAMPDIFF(MINUTE, data_entrada, data_saida)) AS media_min
    FROM (
      SELECT data_entrada, data_saida, UPPER(servico)  AS nome FROM carros WHERE servico  IS NOT NULL
      UNION ALL
      SELECT data_entrada, data_saida, UPPER(servico2) AS nome FROM carros WHERE servico2 IS NOT NULL
      UNION ALL
      SELECT data_entrada, data_saida, UPPER(servico3) AS nome FROM carros WHERE servico3 IS NOT NULL
    ) t
    WHERE data_saida IS NOT NULL
    GROUP BY nome
    HAVING media_min IS NOT NULL
  `;

  const sqlGlobal = `
    SELECT AVG(TIMESTAMPDIFF(MINUTE, data_entrada, data_saida)) AS media_min_global
    FROM carros
    WHERE data_saida IS NOT NULL
  `;

  db.query(sqlByService, (err, rows) => {
    if (err) {
      console.error('Erro médias (byService):', err);
      return res.status(500).json({ error: 'Erro ao calcular médias' });
    }

    const byService = {};
    (rows || []).forEach(r => {
      if (r.servico && r.media_min != null) {
        byService[String(r.servico).toUpperCase()] = Number(r.media_min);
      }
    });

    db.query(sqlGlobal, (err2, rows2) => {
      if (err2) {
        console.error('Erro médias (global):', err2);
        return res.status(500).json({ error: 'Erro ao calcular média global' });
      }
      const global =
        rows2 && rows2[0] && rows2[0].media_min_global != null
          ? Number(rows2[0].media_min_global)
          : null;

      return res.json({
        byService,
        global,
        updatedAt: new Date().toISOString(),
      });
    });
  });
});

module.exports = router;
