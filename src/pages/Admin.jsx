// src/pages/Admin.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import './Admin.css';

// const API_BASE = 'http://localhost:3001';
const API_BASE = 'https://recepcaopneuforte.onrender.com';

// ---------- utils ----------
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
  const off = new Date().getTimezoneOffset();
  const sign = off > 0 ? '-' : '+';
  const HH = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const MM = String(Math.abs(off) % 60).padStart(2, '0');
  return Date.parse(`${s2}${sign}${HH}:${MM}`);
}
function formatHoraManaus(ts) {
  if (!Number.isFinite(ts)) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Manaus', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date(ts));
}
function formatDataManaus(ts) {
  if (!Number.isFinite(ts)) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Manaus', day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(new Date(ts));
}
function fmtHMS(sec) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return [h, m, r].map(n => String(n).padStart(2, '0')).join(':');
}
function toYYYYMMDD(d) {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// ---------- componente ----------
export default function Admin() {
  const [tab, setTab] = useState('hoje');
  const [placa, setPlaca] = useState('');
  const [from, setFrom] = useState(() => toYYYYMMDD(new Date()));
  const [to, setTo] = useState(() => toYYYYMMDD(new Date()));

  const [statusSel, setStatusSel] = useState('TODOS'); // TODOS | EM ANDAMENTO | FINALIZADO
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState(null);
  const [errText, setErrText] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // ---- fetch helpers
  async function fetchJson(url) {
    const r = await fetch(url, { mode: 'cors', cache: 'no-store', credentials: 'omit' });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  }
  async function fetchRelatorio(params) {
    const qs = new URLSearchParams(params).toString();
    return await fetchJson(`${API_BASE}/api/relatorio-carros?${qs}`);
  }
  async function fetchFilaAtual() {
    const data = await fetchJson(`${API_BASE}/api/fila-servico`);
    return (data || []).map(c => {
      const entradaMs = Number.isFinite(c.data_entrada_ms)
        ? c.data_entrada_ms
        : parseDbDateManaus(c.data_entrada);
      return {
        id: c.id,
        placa: c.placa,
        modelo: c.modelo,
        cor: c.cor,
        servico: c.servico,
        servico2: c.servico2,
        servico3: c.servico3,
        num_movimento: c.num_movimento,
        data_entrada: c.data_entrada,
        data_entrada_ms: entradaMs,
        data_saida: null,
        data_saida_ms: null
      };
    });
  }
  function filtraPorStatus(list, status) {
    if (status === 'FINALIZADO') return list.filter(it => it.data_saida || it.data_saida_ms);
    if (status === 'EM ANDAMENTO') return list.filter(it => !(it.data_saida || it.data_saida_ms));
    return list;
  }
  async function buscar(params, { mostrarHintFila = true } = {}) {
    setLoading(true); setErrText(''); setHint(null); setPage(1);
    try {
      const rel = await fetchRelatorio(params);
      setItems(filtraPorStatus(rel, statusSel));
    } catch (e) {
      try {
        const fila = await fetchFilaAtual();
        if (statusSel === 'FINALIZADO') {
          setItems([]);
          if (mostrarHintFila) setHint('Relatório indisponível. Não há finalizados na fila em tempo real.');
        } else {
          setItems(filtraPorStatus(fila, statusSel));
          if (mostrarHintFila) setHint('Mostrando somente carros EM ATENDIMENTO (relatório indisponível).');
        }
      } catch {
        setErrText('Não foi possível carregar os dados (verifique conexão/CORS/backend).');
        setItems([]);
      }
    } finally { setLoading(false); }
  }
  const runBusca = (kind) => {
    if (kind === 'hoje')  return buscar({ from, to: from, status: 'todos' });
    if (kind === 'periodo') return buscar({ from, to, status: 'todos' });
    if (kind === 'placa') {
      const p = (placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
      return buscar({ from, to, placa: p, status: 'todos' }, { mostrarHintFila: false });
    }
  };
  const buscarHoje = () => runBusca('hoje');
  const buscarPeriodo = () => runBusca('periodo');
  const buscarPorPlaca = () => runBusca('placa');

  useEffect(() => { buscarHoje(); /* eslint-disable-line */ }, []);
  useEffect(() => {
    const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);
  useEffect(() => { runBusca(tab); /* eslint-disable-line */ }, [statusSel]);

  // ---- KPIs + destaque min/max
  const { kpis, maxId, minId } = useMemo(() => {
    const total = items.length;
    const finalizadosArr = items.filter(it => it.data_saida || it.data_saida_ms);
    const andamento = total - finalizadosArr.length;

    let maxId = null, maxDur = -1;
    let minId = null, minDur = Number.POSITIVE_INFINITY;

    const longestByService = Object.create(null);
    const primaryService = (it) => it.servico || it.servico2 || it.servico3 || 'OUTRO';

    for (const it of finalizadosArr) {
      const e = it.data_entrada_ms ?? parseDbDateManaus(it.data_entrada);
      const s = it.data_saida_ms ?? parseDbDateManaus(it.data_saida);
      if (!Number.isFinite(e) || !Number.isFinite(s)) continue;
      const dur = Math.max(0, Math.floor((s - e) / 1000));

      if (dur > maxDur) { maxDur = dur; maxId = it.id; }
      if (dur < minDur) { minDur = dur; minId = it.id; }

      const svc = primaryService(it);
      const rec = longestByService[svc];
      if (!rec || dur > rec.dur) {
        longestByService[svc] = { dur, modelo: it.modelo, placa: it.placa };
      }
    }

    let topSvc = null;
    for (const [svc, data] of Object.entries(longestByService)) {
      if (!topSvc || data.dur > topSvc.carro.duracao) {
        topSvc = { nome: svc, carro: { modelo: data.modelo, placa: data.placa, duracao: data.dur } };
      }
    }

    return { kpis: { total, andamento, finalizados: finalizadosArr.length, servicoMais: topSvc || null }, maxId, minId };
  }, [items]);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page]);

  function exportCSV() {
    if (!items.length) return;
    const header = [
      'Data Entrada','Hora Entrada','Data Saída','Hora Saída','Duração (s)',
      'Placa','Modelo','Cor','Serviço','Serviço2','Serviço3','Nº Movimento','Status'
    ];
    const rows = items.map(it => {
      const eMs = it.data_entrada_ms ?? parseDbDateManaus(it.data_entrada);
      const sMs = it.data_saida_ms ?? (it.data_saida ? parseDbDateManaus(it.data_saida) : NaN);
      const dur = (Number.isFinite(eMs) && Number.isFinite(sMs)) ? Math.floor((sMs - eMs)/1000) : '';
      const dataE = Number.isFinite(eMs) ? formatDataManaus(eMs) : '';
      const horaE = Number.isFinite(eMs) ? formatHoraManaus(eMs) : '';
      const dataS = Number.isFinite(sMs) ? formatDataManaus(sMs) : '';
      const horaS = Number.isFinite(sMs) ? formatHoraManaus(sMs) : '';
      return [
        dataE, horaE, dataS, horaS, dur,
        it.placa||'', it.modelo||'', it.cor||'',
        it.servico||'', it.servico2||'', it.servico3||'',
        it.num_movimento||'', it.data_saida||it.data_saida_ms ? 'FINALIZADO' : 'EM ANDAMENTO'
      ];
    });
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `relatorio_${from}_a_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---- PDF
  function exportPDF() {
    if (!items.length) return;

    const statusLabel =
      statusSel === 'FINALIZADO' ? 'Finalizado' :
      statusSel === 'EM ANDAMENTO' ? 'Em andamento' : 'Todos';

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();

    // título
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Administração — Recepção', 40, 40);

    // filtros linha 1
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const gerado = new Date().toLocaleString('pt-BR');
    doc.text(`Período: ${from} a ${to}   |   Status: ${statusLabel}   |   Gerado em: ${gerado}`, 40, 60);

    // KPIs (em uma mini-tabela)
    const svcMais = kpis.servicoMais
      ? `${kpis.servicoMais.nome} — ${fmtHMS(kpis.servicoMais.carro.duracao)}  (${(kpis.servicoMais.carro.modelo || '').toUpperCase()} · ${kpis.servicoMais.carro.placa})`
      : '—';

    autoTable(doc, {
      startY: 80,
      theme: 'grid',
      styles: { fontSize: 10, cellPadding: 6 },
      head: [[ 'Total', 'Em andamento', 'Finalizados', 'Serviço mais demorado' ]],
      body: [[ String(kpis.total), String(kpis.andamento), String(kpis.finalizados), svcMais ]],
      columnStyles: {
        0: { cellWidth: 80 },
        1: { cellWidth: 110 },
        2: { cellWidth: 90 },
        3: { cellWidth: pageWidth - 40 - 40 - (80+110+90) } // preenche o resto
      },
      margin: { left: 40, right: 40 },
      headStyles: { fillColor: [15, 60, 70] }
    });

    // tabela principal
    const startY = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY + 12 : 120;

    const columns = [
      { header: 'Entrada', dataKey: 'entrada' },
      { header: 'Saída',   dataKey: 'saida' },
      { header: 'Dur.',    dataKey: 'dur' },
      { header: 'Placa',   dataKey: 'placa' },
      { header: 'Modelo',  dataKey: 'modelo' },
      { header: 'Cor',     dataKey: 'cor' },
      { header: 'Serviços',dataKey: 'servicos' },
      { header: 'Mov.',    dataKey: 'mov' },
      { header: 'Status',  dataKey: 'status' },
    ];

    const rows = items.map(it => {
      const eMs = it.data_entrada_ms ?? parseDbDateManaus(it.data_entrada);
      const sMs = it.data_saida_ms ?? (it.data_saida ? parseDbDateManaus(it.data_saida) : NaN);
      const dur = (Number.isFinite(eMs) && Number.isFinite(sMs)) ? Math.max(0, Math.floor((sMs - eMs)/1000)) : null;
      const servs = [it.servico, it.servico2, it.servico3].filter(Boolean).join(' | ');
      const isFinal = Boolean(it.data_saida || it.data_saida_ms);

      return {
        entrada: `${Number.isFinite(eMs)?formatDataManaus(eMs):'-'} ${Number.isFinite(eMs)?formatHoraManaus(eMs):''}`,
        saida:   `${Number.isFinite(sMs)?formatDataManaus(sMs):'-'} ${Number.isFinite(sMs)?formatHoraManaus(sMs):''}`,
        dur: fmtHMS(dur),
        placa: it.placa || '',
        modelo: it.modelo || '',
        cor: it.cor || '',
        servicos: servs || '-',
        mov: it.num_movimento || '-',
        status: isFinal ? 'FINALIZADO' : 'EM ANDAMENTO'
      };
    });

    autoTable(doc, {
      startY,
      theme: 'grid',
      head: [columns.map(c => c.header)],
      body: rows.map(r => columns.map(c => r[c.dataKey])),
      styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
      columnStyles: {
        0: { cellWidth: 100 },
        1: { cellWidth: 100 },
        2: { cellWidth: 55 },
        3: { cellWidth: 70 },
        4: { cellWidth: 110 },
        5: { cellWidth: 70 },
        6: { cellWidth: 260 }, // Serviços
        7: { cellWidth: 60 },
        8: { cellWidth: 110 },
      },
      margin: { left: 40, right: 40 },
      headStyles: { fillColor: [9, 35, 45] }
    });

    doc.save(`relatorio_${from}_a_${to}.pdf`);
  }

  const statusLabel =
    statusSel === 'FINALIZADO' ? 'Finalizado' :
    statusSel === 'EM ANDAMENTO' ? 'Em andamento' : 'Todos';

  return (
    <div className="admin">
      <header className="admin__header">
        <h1>📊 Administração — Recepção</h1>

        <div className="admin__header-right">
          {/* menu status */}
          <div className="status-filter" ref={menuRef}>
            <button className="btn btn-ghost status-btn" onClick={() => setMenuOpen(o => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
              {statusLabel} <span className="caret">▾</span>
            </button>
            {menuOpen && (
              <div className="status-menu" role="menu">
                <button className={`status-item ${statusSel==='TODOS'?'is-active':''}`} onClick={() => { setStatusSel('TODOS'); setMenuOpen(false); }}>Todos</button>
                <button className={`status-item ${statusSel==='EM ANDAMENTO'?'is-active':''}`} onClick={() => { setStatusSel('EM ANDAMENTO'); setMenuOpen(false); }}>Em andamento</button>
                <button className={`status-item ${statusSel==='FINALIZADO'?'is-active':''}`} onClick={() => { setStatusSel('FINALIZADO'); setMenuOpen(false); }}>Finalizado</button>
              </div>
            )}
          </div>

          <div className="admin__tabs">
            <button className={tab==='hoje'?'is-active':''} onClick={() => { setTab('hoje'); buscarHoje(); }}>Hoje</button>
            <button className={tab==='periodo'?'is-active':''} onClick={() => setTab('periodo')}>Período</button>
            <button className={tab==='placa'?'is-active':''} onClick={() => setTab('placa')}>Placa</button>
          </div>
        </div>
      </header>

      <div className="admin__body">
        {/* filtros */}
        <section className="admin__filters">
          {tab === 'hoje' && (
            <div className="filter-row">
              <div className="field">
                <label>Referência</label>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
              </div>
              <button className="btn btn-primary" onClick={buscarHoje} disabled={loading}>
                {loading ? 'Carregando…' : 'Buscar do dia'}
              </button>
            </div>
          )}
          {tab === 'periodo' && (
            <div className="filter-row">
              <div className="field">
                <label>De</label>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
              </div>
              <div className="field">
                <label>Até</label>
                <input type="date" value={to} onChange={e => setTo(e.target.value)} />
              </div>
              <button className="btn btn-primary" onClick={buscarPeriodo} disabled={loading}>
                {loading ? 'Carregando…' : 'Buscar período'}
              </button>
            </div>
          )}
          {tab === 'placa' && (
            <div className="filter-row">
              <div className="field">
                <label>Placa</label>
                <input
                  type="text"
                  placeholder="ABC1D23"
                  value={placa}
                  onChange={(e)=>setPlaca(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7))}
                />
              </div>
              <div className="field">
                <label>De</label>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
              </div>
              <div className="field">
                <label>Até</label>
                <input type="date" value={to} onChange={e => setTo(e.target.value)} />
              </div>
              <button className="btn btn-primary" onClick={buscarPorPlaca} disabled={loading}>
                {loading ? 'Carregando…' : 'Buscar'}
              </button>
            </div>
          )}
          {hint && <div className="hint">{hint}</div>}
          {errText && <div className="error">{errText}</div>}
        </section>

        {/* KPIs */}
        <section className="admin__kpis">
          <div className="kpi"><div className="kpi__title">Total</div><div className="kpi__value">{kpis.total}</div></div>
          <div className="kpi"><div className="kpi__title">Em andamento</div><div className="kpi__value">{kpis.andamento}</div></div>
          <div className="kpi"><div className="kpi__title">Finalizados</div><div className="kpi__value">{kpis.finalizados}</div></div>
          <div className="kpi kpi--wide">
            <div className="kpi__title">Serviço mais demorado</div>
            <div className="kpi__value">
              {kpis.servicoMais
                ? `${kpis.servicoMais.nome} — ${fmtHMS(kpis.servicoMais.carro.duracao)}`
                : '—'}
            </div>
            {kpis.servicoMais?.carro && (
              <div className="kpi__sub">
                {kpis.servicoMais.carro.modelo?.toUpperCase()} · {kpis.servicoMais.carro.placa}
              </div>
            )}
          </div>
          <div className="kpi tools">
            <button className="btn btn-secondary" onClick={exportCSV} disabled={!items.length}>Baixar CSV</button>
            <button className="btn btn-secondary" onClick={exportPDF} disabled={!items.length} style={{ marginLeft: 8 }}>Baixar PDF</button>
          </div>
        </section>

        {/* tabela */}
        <section className="admin__tablewrap">
          <table className="admin__table">
            <thead>
              <tr>
                <th>Entrada</th><th>Saída</th><th>Dur.</th><th>Placa</th><th>Modelo</th><th>Cor</th><th>Serviços</th><th>Mov.</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {!items.length && !loading && (<tr><td colSpan="9" className="empty">Sem registros</td></tr>)}
              {pageItems.map(it=>{
                const eMs = it.data_entrada_ms ?? parseDbDateManaus(it.data_entrada);
                const sMs = it.data_saida_ms ?? (it.data_saida ? parseDbDateManaus(it.data_saida) : NaN);
                const dur = (Number.isFinite(eMs) && Number.isFinite(sMs)) ? Math.max(0, Math.floor((sMs - eMs)/1000)) : null;
                const servs = [it.servico, it.servico2, it.servico3].filter(Boolean).join(' | ');
                const isFinal = Boolean(it.data_saida || it.data_saida_ms);

                const rowClass =
                  isFinal && it.id === maxId ? 'row-max' :
                  isFinal && it.id === minId ? 'row-min' : '';

                return (
                  <tr key={it.id} className={rowClass}>
                    <td title={String(it.data_entrada||'')}><div>{Number.isFinite(eMs)?formatDataManaus(eMs):'-'}</div><small>{Number.isFinite(eMs)?formatHoraManaus(eMs):''}</small></td>
                    <td title={String(it.data_saida||'')}><div>{Number.isFinite(sMs)?formatDataManaus(sMs):'-'}</div><small>{Number.isFinite(sMs)?formatHoraManaus(sMs):''}</small></td>
                    <td>{fmtHMS(dur)}</td>
                    <td>{it.placa}</td>
                    <td>{it.modelo}</td>
                    <td>{it.cor}</td>
                    <td className="td-servicos">{servs || '-'}</td>
                    <td>{it.num_movimento || '-'}</td>
                    <td><span className={`badge ${isFinal?'ok':'warn'}`}>{isFinal?'FINALIZADO':'EM ANDAMENTO'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="pager">
            <button className="btn" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>◀</button>
            <span>Página {page} de {totalPages}</span>
            <button className="btn" disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>▶</button>
          </div>
        </section>
      </div>
    </div>
  );
}
