// backend/db.js
const mysql = require('mysql2');
require('dotenv').config();

const isRailway = /rlwy\.net|railway/i.test(process.env.DB_HOST || '');
const sslMode = (process.env.DB_SSL_MODE || (isRailway ? 'require' : 'disable')).toLowerCase();

let ssl; // undefined por padrão
if (sslMode === 'disable') {
  ssl = undefined;
} else if (sslMode === 'require' || sslMode === 'skip-verify') {
  ssl = { rejectUnauthorized: false };
} else if (sslMode === 'verify-ca') {
  const fs = require('fs');
  const ca = process.env.DB_SSL_CA_PATH
    ? fs.readFileSync(process.env.DB_SSL_CA_PATH, 'utf8')
    : (process.env.DB_SSL_CA_BASE64
        ? Buffer.from(process.env.DB_SSL_CA_BASE64, 'base64').toString('utf8')
        : undefined);
  ssl = ca ? { ca } : { rejectUnauthorized: false };
}

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 20000,

  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,

  multipleStatements: false,
  charset: 'utf8mb4',
  dateStrings: true, // devolve DATETIME como string "YYYY-MM-DD HH:MM:SS"

  ssl,
});

const p = pool.promise();

// ⚠️ FIX: toda conexão passa a operar em Manaus (UTC−04:00)
pool.on('connection', (conn) => {
  conn.query("SET time_zone = '-04:00'");
});

pool.on('error', (err) => {
  console.error('[mysql pool error]', err.code || err.message);
});

p.query('SELECT 1')
  .then(() => console.log('✅ MySQL conectado (pool ativo)'))
  .catch((e) => console.error('❌ Falha ao conectar MySQL:', e.code || e.message));

// keepalive
setInterval(async () => {
  try { await p.query('SELECT 1'); }
  catch (e) { console.error('[mysql keepalive failed]', e.code || e.message); }
}, 30000);

// Wrapper compatível
function query(sql, params, cb) {
  if (typeof params === 'function') { cb = params; params = []; }
  if (typeof cb === 'function') {
    return pool.query(sql, params, (err, results) => cb(err, results));
  }
  return p.query(sql, params).then(([rows]) => rows);
}

module.exports = { query, pool: p };
