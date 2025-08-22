// notaRoutes.js
const express = require('express');
const router = express.Router();
const db = require('./db');
const jwt = require('jsonwebtoken');

// bcrypt com fallback para bcryptjs
let bcrypt;
try { bcrypt = require('bcrypt'); }
catch { bcrypt = require('bcryptjs'); }

// TTS backend
const googleTTS = require('google-tts-api');
const doFetch = (...args) =>
  (global.fetch ? global.fetch(...args) : import('node-fetch').then(({ default: f }) => f(...args)));

// ===== deps para MÍDIA (upload local) =====
const path = require('path');
const fs = require('fs');
const multer = require('multer');

/* =================================================================
   ============================ HELPERS ============================
   ================================================================= */
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
  if (['MIDIA'].includes(perfilNorm)) return '/midia';
  if (['ADMIN', 'ADMINISTRADOR'].includes(perfilNorm)) return '/admin';
  return '/balcao';
}

/* =================================================================
   ====================== AUTENTICAÇÃO / ROLES =====================
   ================================================================= */
function verifyAuth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'token_required' });
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'seuSegredo');
    req.user = payload; // { id, usuario, tipo }
    next();
  } catch {
    return res.status(401).json({ error: 'token_invalid' });
  }
}
function requireAdmin(req, res, next) {
  const tipo = normalizePerfil(req.user?.tipo);
  if (['ADMIN', 'ADMINISTRADOR'].includes(tipo)) return next();
  return res.status(403).json({ error: 'forbidden' });
}
function requireRoles(roles) {
  return (req, res, next) => {
    const tipo = normalizePerfil(req.user?.tipo);
    if (roles.map(r => normalizePerfil(r)).includes(tipo)) return next();
    return res.status(403).json({ error: 'forbidden' });
  };
}
const midiaOrAdmin = requireRoles(['MIDIA', 'ADMIN', 'ADMINISTRADOR']);

/* =================================================================
   =============================== LOGIN ===========================
   ================================================================= */
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

    if (senhaDb.startsWith('$2a$') || senhaDb.startsWith('$2b$') || senhaDb.startsWith('$2y$')) {
      try { ok = await bcrypt.compare(senha, senhaDb); } catch { ok = false; }
    } else {
      ok = (senha === senhaDb);
    }
    if (!ok) return res.status(401).json({ error: 'Usuário ou senha inválidos' });

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

/* =================================================================
   ====================== CARROS / FILA / TTS ======================
   ================================================================= */

// CADASTRAR CARRO
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

// LISTAR FILA
router.get('/fila-servico', (_req, res) => {
  const sql = `
    SELECT
      id, placa, modelo, cor, servico, servico2, servico3, num_movimento,
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

// FINALIZAR CARRO
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

      return res.status(200).json({ message: 'Atendimento finalizado com sucesso', carro: carroFinalizado });
    });
  });
});

// TTS
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
   ================= RELATÓRIOS / ESTATÍSTICAS ADMIN ===============
   ================================================================= */
router.get('/relatorio-carros', (req, res) => {
  let { from, to, placa, status } = req.query;

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
  wh.push(`data_entrada >= ? AND data_entrada < DATE_ADD(?, INTERVAL 1 DAY)`);
  params.push(`${from} 00:00:00`, `${to} 00:00:00`);
  if (placa) { wh.push(`placa LIKE ?`); params.push(`%${placa}%`); }
  if (status === 'abertos')  wh.push(`data_saida IS NULL`);
  if (status === 'fechados') wh.push(`data_saida IS NOT NULL`);

  const sql = `
    SELECT
      id, placa, modelo, cor, servico, servico2, servico3, num_movimento,
      data_entrada, data_saida,
      UNIX_TIMESTAMP(CONVERT_TZ(data_entrada, '-04:00', '+00:00')) * 1000 AS data_entrada_ms,
      CASE WHEN data_saida IS NULL THEN NULL
           ELSE UNIX_TIMESTAMP(CONVERT_TZ(data_saida, '-04:00', '+00:00')) * 1000 END AS data_saida_ms
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
   =========================== USUÁRIOS ============================
   ================================================================= */

// Lista usuários
router.get('/usuarios', verifyAuth, requireAdmin, (_req, res) => {
  db.query('SHOW COLUMNS FROM usuarios', (err, cols) => {
    if (err) {
      console.error('SHOW COLUMNS usuarios error:', err.sqlMessage || err.message);
      return res.status(500).json({ error: 'db_error', detail: err.sqlMessage || String(err) });
    }
    const has = (name) => cols?.some(c => String(c.Field).toLowerCase() === String(name).toLowerCase());
    const nameCol = has('nome') ? 'nome' : (has('name') ? 'name' : 'usuario');
    const tipoCol = has('tipo') ? 'tipo'
                  : has('perfil') ? 'perfil'
                  : has('role') ? 'role'
                  : has('cargo') ? 'cargo'
                  : null;

    const sql = `
      SELECT id, ${nameCol} AS nome, usuario, ${tipoCol ? tipoCol : `'VENDEDOR'`} AS tipo
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

// Trocar senha
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
      if (result.affectedRows === 0) return res.status(404).json({ error: 'usuario_nao_encontrado' });
      return res.json({ ok: true });
    });
  } catch (e) {
    console.error('usuarios update password ex:', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

/* =================================================================
   ============================= MÍDIA =============================
   ================================================================= */

// garante pasta de uploads (o app.js já serve /uploads de forma estática)
const UP_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UP_DIR)) fs.mkdirSync(UP_DIR, { recursive: true });

// storage do multer
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UP_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const base = path
      .basename(file.originalname || 'arquivo', ext)
      .replace(/\s+/g, '_')
      .slice(0, 40);
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});
const upload = multer({ storage });

// detecção de colunas opcionais (data_inicio, data_fim, intervalo_minutos)
let midiaColsCache = null;
function hasMidiaCol(name) {
  return midiaColsCache?.some(c => String(c.Field).toLowerCase() === String(name).toLowerCase());
}
function ensureMidiaCols(cb) {
  if (midiaColsCache) return cb(null, midiaColsCache);
  db.query('SHOW COLUMNS FROM midia', (err, cols) => {
    if (err) return cb(err);
    midiaColsCache = cols || [];
    cb(null, midiaColsCache);
  });
}

// GET /api/midia -> lista (protegida)
router.get('/midia', verifyAuth, midiaOrAdmin, (_req, res) => {
  ensureMidiaCols((err) => {
    if (err) {
      console.error('SHOW COLUMNS midia error:', err);
      return res.status(500).json({ error: 'db_error' });
    }
    const optCols = [];
    if (hasMidiaCol('data_inicio')) optCols.push('data_inicio');
    if (hasMidiaCol('data_fim')) optCols.push('data_fim');
    if (hasMidiaCol('intervalo_minutos')) optCols.push('intervalo_minutos');

    const sql = `
      SELECT id, titulo, url, tipo, duracao_seg, ord, ativo
             ${optCols.length ? ',' + optCols.join(',') : ''}
      FROM midia
      ORDER BY ativo DESC, ord ASC, id DESC
    `;
    db.query(sql, (e, rows) => {
      if (e) return res.status(500).json({ error: 'db_error' });
      res.json(rows || []);
    });
  });
});

// POST /api/midia -> upload + insert (protegida)
router.post('/midia', verifyAuth, midiaOrAdmin, upload.single('arquivo'), (req, res) => {
  ensureMidiaCols((err) => {
    if (err) {
      console.error('SHOW COLUMNS midia error:', err);
      return res.status(500).json({ error: 'db_error' });
    }

    const file = req.file;
    const { titulo = '', intervalo_minutos, data_inicio, data_fim, duracao_seg } = req.body || {};
    if (!file) return res.status(400).json({ error: 'arquivo_required' });

    const publicUrl = `/uploads/${file.filename}`;
    const mime = (file.mimetype || '').toLowerCase();
    const tipo = mime.startsWith('video/') ? 'VIDEO' : 'IMG';

    const cols = ['titulo', 'url', 'tipo', 'duracao_seg', 'ord', 'ativo'];
    const vals = [titulo || '', publicUrl, tipo, null, 999999, 1];

    if (tipo === 'IMG') {
      const d = Number(duracao_seg || 10);
      vals[3] = isNaN(d) ? 10 : Math.max(3, d);
    }

    if (hasMidiaCol('data_inicio')) { cols.push('data_inicio'); vals.push(data_inicio || null); }
    if (hasMidiaCol('data_fim'))     { cols.push('data_fim');     vals.push(data_fim || null); }
    if (hasMidiaCol('intervalo_minutos')) {
      const inter = Number(intervalo_minutos || 15);
      cols.push('intervalo_minutos'); vals.push(isNaN(inter) ? 15 : Math.max(1, inter));
    }

    const sql = `
      INSERT INTO midia (${cols.join(',')})
      VALUES (${cols.map(() => '?').join(',')})
    `;
    db.query(sql, vals, (e, result) => {
      if (e) {
        console.error('insert midia error:', e);
        return res.status(500).json({ error: 'db_error' });
      }
      res.json({ ok: true, id: result.insertId, url: publicUrl });
    });
  });
});

// PUT /api/midia/:id -> update meta (protegida)
router.put('/midia/:id', verifyAuth, midiaOrAdmin, (req, res) => {
  ensureMidiaCols((err) => {
    if (err) return res.status(500).json({ error: 'db_error' });

    const { id } = req.params;
    const { titulo, duracao_seg, ord, ativo, data_inicio, data_fim, intervalo_minutos } = req.body || {};

    const sets = [];
    const vals = [];

    if (titulo != null)      { sets.push('titulo = ?');      vals.push(String(titulo)); }
    if (duracao_seg != null) { sets.push('duracao_seg = ?'); vals.push(Number(duracao_seg) || 10); }
    if (ord != null)         { sets.push('ord = ?');         vals.push(Number(ord) || 0); }
    if (ativo != null)       { sets.push('ativo = ?');       vals.push(Number(ativo) ? 1 : 0); }

    if (hasMidiaCol('data_inicio') && 'data_inicio' in req.body) {
      sets.push('data_inicio = ?'); vals.push(data_inicio || null);
    }
    if (hasMidiaCol('data_fim') && 'data_fim' in req.body) {
      sets.push('data_fim = ?');     vals.push(data_fim || null);
    }
    if (hasMidiaCol('intervalo_minutos') && 'intervalo_minutos' in req.body) {
      sets.push('intervalo_minutos = ?'); vals.push(Number(intervalo_minutos) || 15);
    }

    if (!sets.length) return res.json({ ok: true });

    vals.push(id);
    const sql = `UPDATE midia SET ${sets.join(', ')} WHERE id = ?`;
    db.query(sql, vals, (e, result) => {
      if (e) return res.status(500).json({ error: 'db_error' });
      if (result.affectedRows === 0) return res.status(404).json({ error: 'not_found' });
      res.json({ ok: true });
    });
  });
});

// DELETE /api/midia/:id -> remove e apaga arquivo local (protegida)
router.delete('/midia/:id', verifyAuth, midiaOrAdmin, (req, res) => {
  const { id } = req.params;
  db.query('SELECT url FROM midia WHERE id = ?', [id], (e, rows) => {
    if (e) return res.status(500).json({ error: 'db_error' });
    if (!rows || !rows.length) return res.status(404).json({ error: 'not_found' });

    const url = rows[0].url || '';
    db.query('DELETE FROM midia WHERE id = ?', [id], (e2) => {
      if (e2) return res.status(500).json({ error: 'db_error' });

      if (url.startsWith('/uploads/')) {
        const p = path.join(__dirname, url.replace('/uploads/', 'uploads/'));
        fs.promises.unlink(p).catch(() => {});
      }
      res.json({ ok: true });
    });
  });
});

/* =================================================================
   ================== PLAYLIST (pública para o Painel) =============
   ================================================================= */
// GET /api/playlist?now=ISO|timestamp_ms (opcional)
router.get('/playlist', (req, res) => {
  // helper: Date -> 'YYYY-MM-DD HH:MM:SS'
  const toMySQL = (d) => {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  // parse "now" (opcional)
  let now = new Date();
  if (req.query.now) {
    const n = Number(req.query.now);
    now = isNaN(n) ? new Date(String(req.query.now)) : new Date(n);
  }
  if (isNaN(now.getTime())) now = new Date();
  const nowStr = toMySQL(now);

  ensureMidiaCols((err) => {
    if (err) {
      console.error('SHOW COLUMNS midia error:', err);
      return res.status(500).json({ error: 'db_error' });
    }

    const fields = ['id','titulo','url','tipo','duracao_seg','ord','ativo'];
    if (hasMidiaCol('data_inicio'))        fields.push('data_inicio');
    if (hasMidiaCol('data_fim'))           fields.push('data_fim');
    if (hasMidiaCol('intervalo_minutos'))  fields.push('intervalo_minutos');

    const where = ['ativo = 1'];
    const params = [];

    if (hasMidiaCol('data_inicio')) { where.push('(data_inicio IS NULL OR data_inicio <= ?)'); params.push(nowStr); }
    if (hasMidiaCol('data_fim'))    { where.push('(data_fim IS NULL OR data_fim >= ?)');       params.push(nowStr); }

    const sql = `
      SELECT ${fields.join(', ')}
      FROM midia
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ord ASC, id ASC
    `;

    db.query(sql, params, (e, rows) => {
      if (e) {
        console.error('playlist error:', e);
        return res.status(500).json({ error: 'db_error' });
      }
      const base = `${req.protocol}://${req.get('host')}`;
      const data = (rows || []).map(r => ({
        ...r,
        src: /^https?:\/\//i.test(r.url) ? r.url : `${base}${r.url}`
      }));
      res.json({ now: nowStr, items: data });
    });
  });
});

module.exports = router;
