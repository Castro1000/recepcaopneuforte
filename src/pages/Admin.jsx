import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import './Admin.css';

const API_BASE = 'http://localhost:3001';
// const API_BASE = 'https://recepcaopneuforte.onrender.com';

function parseDbDateManaus(input) {
  if (!input) return NaN;
  if (input instanceof Date) return input.getTime();
  const raw = String(input).trim();

  let t = Date.parse(raw);
  if (!Number.isNaN(t)) return t;

  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const [, Y, M, D, h, mm, ss] = m;
    const sManaus = `${Y}-${M}-${D}T${h}:${mm}:${ss}-04:00`;
    t = Date.parse(sManaus);
    if (!Number.isNaN(t)) return t;
  }
  const s2 = raw.replace(' ', 'T');
  const offsetMin = new Date().getTimezoneOffset();
  const sign = offsetMin > 0 ? '-' : '+';
  const HH = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0');
  const MM = String(Math.abs(offsetMin) % 60).padStart(2, '0');
  const s3 = `${s2}${sign}${HH}:${MM}`;
  t = Date.parse(s3);
  return t;
}

function formatHoraManaus(ts) {
  if (!Number.isFinite(ts)) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Manaus',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(ts));
}

function fmtHMS(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

const SERVICOS = [
  'TROCA DE OLEO','TROCA DE PNEUS','RODIZIO',
  'COMBO ALINHAMENTO E BALANCEAMENTO','ALINHAMENTO',
  'REVISÃO GERAL DOS FILTROS','REVISÃO','CAMBAGEM','CASTER','CONSERTO',
  'MONTAGEM','DIAGNÓSTICO','NITROGÊNIO','BATERIA','MOTOR',
  'AR-CONDICIONADO','ELETRICA','EMBREAGEM','DIAGNOSTICO ELETRONICO','OUTRO'
];

export default function Admin() {
  // filtros
  const [placa, setPlaca] = useState('');
  const [mov, setMov] = useState('');
  const [status, setStatus] = useState('todos'); // todos | abertos | finalizados
  const [servico, setServico] = useState('');
  const [inicio, setInicio] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0,10);
  });
  const [fim, setFim] = useState(() => new Date().toISOString().slice(0,10));

  // dados
  const [linhas, setLinhas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  const buscar = async () => {
    setErro('');
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_BASE}/api/admin/busca`, {
        params: {
          placa: placa.trim().toUpperCase(),
          mov: mov.trim(),
          status,
          servico,
          ini: inicio,
          fim,
        }
      });
      setLinhas(data || []);
    } catch (e) {
      console.error(e);
      setErro('Falha ao buscar dados.');
    } finally {
      setLoading(false);
    }
  };

  const limpar = () => {
    setPlaca('');
    setMov('');
    setStatus('todos');
    setServico('');
    const d = new Date(); d.setDate(d.getDate() - 7);
    setInicio(d.toISOString().slice(0,10));
    setFim(new Date().toISOString().slice(0,10));
    setLinhas([]);
  };

  useEffect(() => {
    buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // métricas calculadas no cliente
  const kpis = useMemo(() => {
    const total = linhas.length;

    let finalizados = 0;
    let somaDurFinal = 0;
    const porServico = new Map();
    const porDia = new Map();

    for (const r of linhas) {
      const eMs = r.data_entrada_ms ?? parseDbDateManaus(r.data_entrada);
      const sMs = r.data_saida_ms ?? (r.data_saida ? parseDbDateManaus(r.data_saida) : null);

      if (sMs) {
        finalizados++;
        somaDurFinal += Math.max(0, Math.floor((sMs - eMs)/1000));
      }

      // serviços
      [r.servico, r.servico2, r.servico3].filter(Boolean).forEach(s => {
        const k = String(s).toUpperCase();
        porServico.set(k, (porServico.get(k) || 0) + 1);
      });

      // por dia (entrada)
      if (Number.isFinite(eMs)) {
        const d = new Date(eMs);
        const key = d.toISOString().slice(0,10); // YYYY-MM-DD
        porDia.set(key, (porDia.get(key) || 0) + 1);
      }
    }

    const tempoMedio = finalizados > 0 ? Math.round(somaDurFinal / finalizados) : 0;
    // top serviço
    let topServ = '-';
    if (porServico.size) {
      topServ = [...porServico.entries()].sort((a,b)=>b[1]-a[1])[0][0];
    }

    return {
      total,
      emAndamento: total - finalizados,
      finalizados,
      tempoMedio,
      topServ,
      porServico: [...porServico.entries()],
      porDia: [...porDia.entries()].sort((a,b)=>a[0].localeCompare(b[0])),
    };
  }, [linhas]);

  // CSV do que está na tabela
  const exportarCSV = () => {
    if (!linhas.length) return;
    const header = [
      'ID','MODELO','PLACA','COR','MOV','SERVICO','SERVICO2','SERVICO3',
      'ENTRADA','SAIDA','DURACAO(seg)'
    ];
    const rows = linhas.map(r => {
      const e = r.data_entrada_ms ?? parseDbDateManaus(r.data_entrada);
      const s = r.data_saida_ms ?? (r.data_saida ? parseDbDateManaus(r.data_saida) : null);
      const dur = (Number.isFinite(e) && Number.isFinite(s)) ? Math.max(0, Math.floor((s-e)/1000)) : '';
      return [
        r.id, (r.modelo||'').toUpperCase(), (r.placa||'').toUpperCase(), r.cor||'',
        r.num_movimento||'', r.servico||'', r.servico2||'', r.servico3||'',
        Number.isFinite(e) ? new Date(e).toISOString() : '',
        Number.isFinite(s) ? new Date(s).toISOString() : '',
        dur
      ].map(v => `"${String(v).replaceAll('"','""')}"`).join(',');
    });
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `relatorio-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-title">📊 Painel do Administrador</div>
        <div className="admin-actions">
          <button onClick={exportarCSV} className="btn ghost">Exportar CSV</button>
          <button onClick={buscar} className="btn primary" disabled={loading}>
            {loading ? 'Buscando…' : 'Buscar'}
          </button>
        </div>
      </header>

      <section className="admin-filters">
        <div className="field">
          <label>Placa</label>
          <input
            value={placa}
            onChange={(e)=>setPlaca(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7))}
            placeholder="ABC1D23"
          />
        </div>
        <div className="field">
          <label>Nº do movimento</label>
          <input value={mov} onChange={(e)=>setMov(e.target.value)} placeholder="Ex.: 321654" />
        </div>
        <div className="field">
          <label>Status</label>
          <select value={status} onChange={(e)=>setStatus(e.target.value)}>
            <option value="todos">Todos</option>
            <option value="abertos">Em andamento</option>
            <option value="finalizados">Finalizados</option>
          </select>
        </div>
        <div className="field">
          <label>Serviço</label>
          <select value={servico} onChange={(e)=>setServico(e.target.value)}>
            <option value="">Todos</option>
            {SERVICOS.map((s,i)=><option key={i} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Início</label>
          <input type="date" value={inicio} onChange={(e)=>setInicio(e.target.value)} />
        </div>
        <div className="field">
          <label>Fim</label>
          <input type="date" value={fim} onChange={(e)=>setFim(e.target.value)} />
        </div>
        <div className="field buttons">
          <button className="btn" onClick={limpar}>Limpar</button>
        </div>
      </section>

      <section className="admin-kpis">
        <div className="kpi-card">
          <div className="kpi-label">Atendimentos</div>
          <div className="kpi-value">{kpis.total}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Finalizados</div>
          <div className="kpi-value">{kpis.finalizados}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Em andamento</div>
          <div className="kpi-value">{kpis.emAndamento}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Tempo médio</div>
          <div className="kpi-value">{fmtHMS(kpis.tempoMedio)}</div>
        </div>
        <div className="kpi-card wide">
          <div className="kpi-label">Top serviço</div>
          <div className="kpi-value">{kpis.topServ}</div>
        </div>
      </section>

      {/* “Gráficos” simples só com barras CSS para não depender de libs */}
      <section className="admin-charts">
        <div className="chart-card">
          <div className="chart-title">Atendimentos por dia</div>
          <div className="bars">
            {kpis.porDia.map(([d, qtd]) => (
              <div key={d} className="bar">
                <div className="bar-fill" style={{height: 8 + qtd*10}} />
                <div className="bar-x">{d.slice(5)}</div>
                <div className="bar-y">{qtd}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-title">Serviços mais realizados</div>
          <ul className="list-bars">
            {kpis.porServico
              .sort((a,b)=>b[1]-a[1])
              .slice(0,8)
              .map(([nome, qtd]) => (
                <li key={nome}>
                  <span className="lb-name">{nome}</span>
                  <span className="lb-bar"><i style={{width: `${10 + qtd*8}px`}}/></span>
                  <span className="lb-val">{qtd}</span>
                </li>
              ))}
          </ul>
        </div>
      </section>

      <section className="admin-table">
        {erro && <div className="error">{erro}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Modelo</th>
                <th>Placa</th>
                <th>Cor</th>
                <th>MOV</th>
                <th>Serviços</th>
                <th>Entrada</th>
                <th>Saída</th>
                <th>Duração</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(r => {
                const eMs = r.data_entrada_ms ?? parseDbDateManaus(r.data_entrada);
                const sMs = r.data_saida_ms ?? (r.data_saida ? parseDbDateManaus(r.data_saida) : null);
                const dur = (Number.isFinite(eMs) && Number.isFinite(sMs))
                  ? Math.max(0, Math.floor((sMs - eMs)/1000))
                  : null;
                const statusRow = sMs ? 'FINALIZADO' : 'EM ANDAMENTO';
                return (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td className="wrap">{String(r.modelo||'').toUpperCase()}</td>
                    <td>{String(r.placa||'').toUpperCase()}</td>
                    <td>{r.cor}</td>
                    <td className="wrap">{r.num_movimento || '-'}</td>
                    <td className="wrap">{[r.servico, r.servico2, r.servico3].filter(Boolean).join(' | ') || '-'}</td>
                    <td>{formatHoraManaus(eMs)}</td>
                    <td>{sMs ? formatHoraManaus(sMs) : '-'}</td>
                    <td>{dur != null ? fmtHMS(dur) : '-'}</td>
                    <td>
                      <span className={`badge ${sMs ? 'ok' : 'open'}`}>{statusRow}</span>
                    </td>
                  </tr>
                );
              })}
              {!linhas.length && !loading && (
                <tr><td colSpan="10" style={{textAlign:'center', opacity:.7}}>Sem resultados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
