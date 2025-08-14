// notaRoutes.js
const express = require('express');
const router = express.Router();
const db = require('./db');
const jwt = require('jsonwebtoken');

// === (novo) TTS backend ===
const googleTTS = require('google-tts-api');
// usa fetch nativo do Node 18+; se não houver, carrega node-fetch dinamicamente
const doFetch = (...args) =>
  (global.fetch ? global.fetch(...args) : import('node-fetch').then(({ default: f }) => f(...args)));

// ---------- helpers ----------
function normalizePerfil(p) {
  return String(p || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}
function decideRedirect(perfilNorm) {
  if (['RECEPCAO', 'PAINEL', 'TV'].includes(perfilNorm)) return '/painel';
  if (['VENDEDOR', 'BALCAO'].includes(perfilNorm)) return '/balcao';
  if (['ADMIN', 'ADMINISTRADOR'].includes(perfilNorm)) return '/admin';
  return '/balcao';
}

// ----------------------------- LOGIN -----------------------------
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
      const perfilRaw = user.tipo ?? user.perfil ?? user.role ?? user.cargo ?? 'VENDEDOR';
      const perfilNorm = normalizePerfil(perfilRaw);

      const token = jwt.sign(
        { id: user.id, usuario: user.usuario, tipo: perfilNorm },
        process.env.JWT_SECRET || 'seuSegredo',
        { expiresIn: '1h' }
      );

      return res.json({
        token,
        tipo: perfilNorm,
        nome: user.name ?? user.nome ?? user.usuario,
        redirect: decideRedirect(perfilNorm),
      });
    }

    return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  });
});

// ------ CADASTRAR CARRO (servico2, servico3, num_movimento) ------
router.post('/cadastrar-carro', (req, res) => {
  const { placa, modelo, cor, servico, servico2, servico3, num_movimento } = req.body;

  // validações mínimas também no backend
  if (!placa || !modelo || !cor || !servico || !num_movimento) {
    return res.status(400).json({ error: 'Campos obrigatórios faltando' });
  }

  const sql = `
    INSERT INTO carros
      (placa, modelo, cor, servico, servico2, servico3, num_movimento, data_entrada)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00','-04:00'))
  `;

  const values = [
    String(placa).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7),
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

    const io = req.app.get('io');
    if (io) io.emit('novoCarroAdicionado');

    return res.status(200).json({ message: 'Carro cadastrado com sucesso', id: result.insertId });
  });
});

// ------------------------- LISTAR FILA -------------------------
router.get('/fila-servico', (req, res) => {
  // IMPORTANTE: converter Manaus -> UTC antes de UNIX_TIMESTAMP
  const sql = `
    SELECT
      id,
      placa,
      modelo,
      cor,
      servico,
      servico2,
      servico3,
      num_movimento,
      data_entrada,
      UNIX_TIMESTAMP(CONVERT_TZ(data_entrada, '-04:00', '+00:00')) * 1000 AS data_entrada_ms
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

// ---- FINALIZAR (grava data_saida em Manaus e emite socket) ----
router.put('/finalizar-carro/:id', (req, res) => {
  const { id } = req.params;

  const updateSql = `
    UPDATE carros
    SET data_saida = CONVERT_TZ(UTC_TIMESTAMP(), '+00:00','-04:00')
    WHERE id = ?
  `;

  const selectSql = `
    SELECT
      *,
      UNIX_TIMESTAMP(CONVERT_TZ(data_entrada, '-04:00', '+00:00')) * 1000 AS data_entrada_ms,
      UNIX_TIMESTAMP(CONVERT_TZ(data_saida,   '-04:00', '+00:00')) * 1000 AS data_saida_ms
    FROM carros
    WHERE id = ?
  `;

  db.query(updateSql, [id], (err) => {
    if (err) {
      console.error('Erro ao finalizar atendimento:', err);
      return res.status(500).json({ error: 'Erro ao finalizar atendimento' });
    }

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
        carro: carroFinalizado,
      });
    });
  });
});

// ------------------------- (novo) TTS -------------------------
// GET /api/tts?text=...
// Retorna áudio MP3 (voice pt-BR) do texto informado.
router.get('/tts', async (req, res) => {
  try {
    const text = (req.query.text || '').toString().trim();
    if (!text) return res.status(400).json({ error: 'text required' });

    const url = googleTTS.getAudioUrl(text, {
      lang: 'pt-BR',
      slow: false,
      host: 'https://translate.google.com',
    });

    const r = await doFetch(url);
    if (!r.ok) throw new Error(`fetch TTS failed: ${r.status}`);

    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-store');
    r.body.pipe(res);
  } catch (e) {
    console.error('TTS error:', e);
    res.status(500).json({ error: 'tts_failed' });
  }
});

module.exports = router;
