// notaRoutes.js
const express = require('express');
const router = express.Router();
const db = require('./db');
const jwt = require('jsonwebtoken');

// bcrypt com fallback para bcryptjs (100% JS)
let bcrypt;
try { bcrypt = require('bcrypt'); }
catch { bcrypt = require('bcryptjs'); }

// === (já existente) TTS backend ===
const googleTTS = require('google-tts-api');
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

// ---------- Auth: middlewares ----------
function verifyAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'token_required' });
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'seuSegredo');
    req.user = payload; // { id, usuario, tipo }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'token_invalid' });
  }
}
function requireAdmin(req, res, next) {
  const tipo = normalizePerfil(req.user?.tipo);
  if (['ADMIN', 'ADMINISTRADOR'].includes(tipo)) return next();
  return res.status(403).json({ error: 'forbidden' });
}

// ----------------------------- LOGIN -----------------------------
// Compatível com bcrypt (hash) e com senhas antigas em texto plano.
router.post('/login', (req, res) => {
  const { usuario, senha } = req.body;
  const sql = 'SELECT * FROM usuarios WHERE usuario = ? LIMIT 1';

  db.query(sql, [usuario], async (err, results) => {
    if (err) {
      console.error('Erro no login:', err);
      return res.status(500).json({ error: 'Erro no servidor' });
    }

    if (!results || results.length === 0) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    const user = results[0];
    const senhaDb = user.senha || '';
    let ok = false;

    // tenta como hash bcrypt
    if (senhaDb.startsWith('$2a$') || senhaDb.startsWith('$2b$') || senhaDb.startsWith('$2y$')) {
      try { ok = await bcrypt.compare(senha, senhaDb); }
      catch { ok = false; }
    } else {
      // compatibilidade com senha em texto
      ok = (senha === senhaDb);
    }

    if (!ok) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

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
  });
});

// ------ CADASTRAR CARRO ------
router.post('/cadastrar-carro', (req, res) => {
  const { placa, modelo, cor, servico, servico2, servico3, num_movimento } = req.body;

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

// ------------------------- (existente) TTS -------------------------
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

/* =================================================================
   ========== ENDPOINTS PARA A PÁGINA ADMIN ==========
   ================================================================= */

// GET /api/relatorio-carros?from=YYYY-MM-DD&to=YYYY-MM-DD&placa=ABC1234&status=todos|abertos|fechados
router.get('/relatorio-carros', (req, res) => {
  let { from, to, placa, status } = req.query;

  // defaults: hoje
  const hoje = new Date();
  const y = hoje.getFullYear();
  const m = String(hoje.getMonth() + 1).padStart(2, '0');
  const d = String(hoje.getDate()).padStart(2, '0');
  const hojeStr = `${y}-${m}-${d}`;

  from = (from || hojeStr).slice(0, 10);
  to   = (to   || from).slice(0, 10);
  placa = (placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  status = (status || 'todos').toLowerCase();

  const wh = [];
  const params = [];

  // intervalo: [from 00:00:00, to + 1dia 00:00:00)
  wh.push(`data_entrada >= ? AND data_entrada < DATE_ADD(?, INTERVAL 1 DAY)`);
  params.push(`${from} 00:00:00`, `${to} 00:00:00`);

  if (placa) { wh.push(`placa LIKE ?`); params.push(`%${placa}%`); }
  if (status === 'abertos')   wh.push(`data_saida IS NULL`);
  if (status === 'fechados')  wh.push(`data_saida IS NOT NULL`);

  const sql = `
    SELECT
      id, placa, modelo, cor, servico, servico2, servico3, num_movimento,
      data_entrada, data_saida,
      UNIX_TIMESTAMP(CONVERT_TZ(data_entrada, '-04:00', '+00:00')) * 1000 AS data_entrada_ms,
      CASE WHEN data_saida IS NULL THEN NULL
           ELSE UNIX_TIMESTAMP(CONVERT_TZ(data_saida, '-04:00', '+00:00')) * 1000
      END AS data_saida_ms
    FROM carros
    WHERE ${wh.join(' AND ')}
    ORDER BY data_entrada DESC
  `;

  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error('relatorio-carros error:', err);
      return res.status(500).json({ error: 'db_error' });
    }
    res.json(rows || []);
  });
});

// Soma a duração (em segundos) por serviço (servico/servico2/servico3) apenas dos finalizados.
router.get('/estatisticas-servicos', (req, res) => {
  let { from, to } = req.query;

  const hoje = new Date();
  const y = hoje.getFullYear();
  const m = String(hoje.getMonth() + 1).padStart(2, '0');
  const d = String(hoje.getDate()).padStart(2, '0');
  const hojeStr = `${y}-${m}-${d}`;

  from = (from || hojeStr).slice(0, 10);
  to   = (to   || from).slice(0, 10);

  const rangeWhere = `data_entrada >= ? AND data_entrada < DATE_ADD(?, INTERVAL 1 DAY) AND data_saida IS NOT NULL`;
  const params = [
    `${from} 00:00:00`, `${to} 00:00:00`,
    `${from} 00:00:00`, `${to} 00:00:00`,
    `${from} 00:00:00`, `${to} 00:00:00`
  ];

  const sql = `
    SELECT nome, SUM(dur) AS total_seg, COUNT(*) AS itens
    FROM (
      SELECT servico  AS nome, TIMESTAMPDIFF(SECOND, data_entrada, data_saida) AS dur
      FROM carros WHERE servico  IS NOT NULL AND ${rangeWhere}
      UNION ALL
      SELECT servico2 AS nome, TIMESTAMPDIFF(SECOND, data_entrada, data_saida) AS dur
      FROM carros WHERE servico2 IS NOT NULL AND ${rangeWhere}
      UNION ALL
      SELECT servico3 AS nome, TIMESTAMPDIFF(SECOND, data_entrada, data_saida) AS dur
      FROM carros WHERE servico3 IS NOT NULL AND ${rangeWhere}
    ) x
    GROUP BY nome
    ORDER BY total_seg DESC
  `;

  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error('estatisticas-servicos error:', err);
      return res.status(500).json({ error: 'db_error' });
    }
    res.json(rows || []);
  });
});

/* =================================================================
   ========== NOVOS ENDPOINTS DE USUÁRIOS (ADMIN) ==========
   ================================================================= */

// Lista de usuários (somente ADMIN) — detecta colunas existentes
router.get('/usuarios', verifyAuth, requireAdmin, (req, res) => {
  db.query('SHOW COLUMNS FROM usuarios', (err, cols) => {
    if (err) {
      console.error('SHOW COLUMNS usuarios error:', err.sqlMessage || err.message);
      return res.status(500).json({ error: 'db_error', detail: err.sqlMessage || String(err) });
    }

    const has = (name) =>
      cols?.some(c => String(c.Field).toLowerCase() === String(name).toLowerCase());

    // escolhe a melhor coluna para "nome" e "tipo"
    const nameCol = has('nome') ? 'nome' : (has('name') ? 'name' : 'usuario');
    const tipoCol = has('tipo') ? 'tipo'
                  : has('perfil') ? 'perfil'
                  : has('role') ? 'role'
                  : has('cargo') ? 'cargo'
                  : null;

    // monta SQL com o que existe
    const sql = `
      SELECT
        id,
        ${nameCol} AS nome,
        usuario,
        ${tipoCol ? tipoCol : `'VENDEDOR'`} AS tipo
      FROM usuarios
      ORDER BY ${nameCol} ASC
    `;

    db.query(sql, (err2, rows) => {
      if (err2) {
        console.error('usuarios list error:', err2.sqlMessage || err2.message);
        return res.status(500).json({ error: 'db_error', detail: err2.sqlMessage || String(err2) });
      }
      res.json(rows || []);
    });
  });
});



// Troca de senha (somente ADMIN)
// Body: { novaSenha: string }
router.put('/usuarios/:id/senha', verifyAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { novaSenha } = req.body || {};
    if (!id || !novaSenha || String(novaSenha).length < 4) {
      return res.status(400).json({ error: 'senha_invalida' });
    }

    const hash = await bcrypt.hash(String(novaSenha), 10);
    const sql = `UPDATE usuarios SET senha = ? WHERE id = ?`;

    db.query(sql, [hash, id], (err, result) => {
      if (err) {
        console.error('usuarios update password error:', err);
        return res.status(500).json({ error: 'db_error' });
      }
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'usuario_nao_encontrado' });
      }
      return res.json({ ok: true });
    });
  } catch (e) {
    console.error('usuarios update password ex:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
