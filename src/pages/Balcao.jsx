import React, { useEffect, useState } from 'react';
import axios from 'axios';
import './Balcao.css';

const API_BASE = 'http://localhost:3001';
// const API_BASE = 'https://recepcaopneuforte.onrender.com';

/** Interpreta data do MySQL como Manaus quando vier "YYYY-MM-DD HH:mm:ss".
 *  Se vier ISO/Z ou Date, também funciona. Retorna timestamp (ms).
 */
function parseDbDateManaus(input) {
  if (!input) return NaN;
  if (input instanceof Date) return input.getTime();

  const raw = String(input).trim();

  // 1) ISO (com Z/offset)
  let t = Date.parse(raw);
  if (!Number.isNaN(t)) return t;

  // 2) "YYYY-MM-DD HH:mm:ss" -> força -04:00
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const [, Y, M, D, h, mm, ss] = m;
    const sManaus = `${Y}-${M}-${D}T${h}:${mm}:${ss}-04:00`;
    t = Date.parse(sManaus);
    if (!Number.isNaN(t)) return t;
  }

  // 3) fallback: cola offset local
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

export default function Balcao() {
  // ------- form -------
  const [placa, setPlaca] = useState('');
  const [modelo, setModelo] = useState('');
  const [cor, setCor] = useState('');
  const [numMovimento, setNumMovimento] = useState('');

  // serviços dinâmicos
  const [servicoSelects, setServicoSelects] = useState(['']);
  const [servicos, setServicos] = useState(['']);

  // ------- dados / ui -------
  const [carros, setCarros] = useState([]);
  const [confirmandoId, setConfirmandoId] = useState(null);
  const [alerta, setAlerta] = useState(null); // {tipo:'erro'|'sucesso', texto:'..'}

  // destaque pós-finalização (card piscando N segundos)
  const [destaque, setDestaque] = useState(null); // {carro}

  // “Relógio” para cronômetro (1s)
  const [now, setNow] = useState(Date.now());

  // trava teclado/scroll enquanto o destaque estiver ativo
  useEffect(() => {
    if (!destaque) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const blockKeys = (e) => {
      // bloqueia todas as teclas (inclui ESC, Enter, etc.)
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', blockKeys, true);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', blockKeys, true);
    };
  }, [destaque]);

  // -----------------------------------
  // Efeitos
  // -----------------------------------
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const buscarCarros = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/fila-servico`);
      setCarros(res.data || []);
    } catch (e) {
      console.error('Erro ao buscar carros:', e);
    }
  };

  useEffect(() => {
    buscarCarros();
    const i = setInterval(buscarCarros, 5000);
    return () => clearInterval(i);
  }, []);

  // -----------------------------------
  // serviços dinâmicos do form
  // -----------------------------------
  const addServico = () => {
    if (servicos.length >= 3) return;
    setServicoSelects((p) => [...p, '']);
    setServicos((p) => [...p, '']);
  };

  const removeServico = (idx) => {
    setServicoSelects((p) => p.filter((_, i) => i !== idx));
    setServicos((p) => p.filter((_, i) => i !== idx));
  };

  const changeServicoSelect = (idx, value) => {
    const v = (value || '').toUpperCase();
    setServicoSelects((p) => p.map((s, i) => (i === idx ? v : s)));
    setServicos((p) => p.map((s, i) => (i === idx ? (v === 'OUTRO' ? '' : v) : s)));
  };

  const changeServicoCustom = (idx, value) => {
    const v = (value || '').toUpperCase();
    setServicos((p) => p.map((s, i) => (i === idx ? v : s)));
  };

  // -----------------------------------
  // validação e submit
  // -----------------------------------
  const onChangePlaca = (e) => {
    const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
    setPlaca(v);
  };

  const validarObrigatorios = () => {
    const faltas = [];
    if (!modelo.trim()) faltas.push('Carro');

    // placa exatamente 7
    if (placa.length !== 7) faltas.push('Placa (exatamente 7 caracteres)');

    if (!cor.trim()) faltas.push('Cor');
    if (!numMovimento.trim()) faltas.push('Nº do movimento');
    const s1 = (servicos[0] || '').trim();
    if (!s1) faltas.push('Serviço (mínimo 1)');

    if (faltas.length) {
      setAlerta({
        tipo: 'erro',
        texto: `Preencha os campos obrigatórios:\n• ${faltas.join('\n• ')}`
      });
      return false;
    }
    return true;
  };

  const handleCadastro = async (e) => {
    e.preventDefault();
    if (!validarObrigatorios()) return;

    const payload = {
      placa: placa.trim().toUpperCase(),
      modelo: modelo.trim().toUpperCase(),
      cor: cor.trim().toUpperCase(),
      num_movimento: numMovimento.trim(),
      servico: (servicos[0] || '').trim() || null,
      servico2: (servicos[1] || '').trim() || null,
      servico3: (servicos[2] || '').trim() || null
    };

    try {
      await axios.post(`${API_BASE}/api/cadastrar-carro`, payload);

      // limpa form
      setPlaca('');
      setModelo('');
      setCor('');
      setNumMovimento('');
      setServicoSelects(['']);
      setServicos(['']);

      setAlerta({ tipo: 'sucesso', texto: 'Carro cadastrado com sucesso!' });
      buscarCarros();
    } catch (error) {
      console.error('Erro ao cadastrar carro:', error);
      setAlerta({ tipo: 'erro', texto: 'Erro ao cadastrar o carro.' });
    }
  };

  // -----------------------------------
  // finalizar
  // -----------------------------------
  const confirmarFinalizar = (id) => {
    // não permite abrir confirmação enquanto destaque está ativo
    if (destaque) return;
    setConfirmandoId(id);
  };
  const cancelarFinalizar = () => setConfirmandoId(null);

  const finalizarAtendimento = async (id) => {
    try {
      const { data } = await axios.put(`${API_BASE}/api/finalizar-carro/${id}`);
      setConfirmandoId(null);
      buscarCarros();

      // destaque visual 20s + bloqueio total de UI
      if (data && data.carro) {
        setDestaque(data.carro);
        setTimeout(() => setDestaque(null), 20000); // 20s
      }
    } catch (error) {
      console.error('Erro ao finalizar carro:', error);
    }
  };

  const cores = [
    'PRETO', 'BRANCO', 'CINZA', 'VERMELHO', 'AZUL',
    'VERDE', 'AMARELO', 'ROSA', 'LARANJA', 'ROXO'
  ];

  const servicosLista = [
    'TROCA DE OLEO', 'TROCA DE PNEUS', 'RODIZIO',
    'COMBO ALINHAMENTO E BALANCEAMENTO', 'ALINHAMENTO',
    'REVISÃO GERAL DOS FILTROS', 'REVISÃO', 'CAMBAGEM', 'CASTER', 'CONSERTO',
    'MONTAGEM', 'DIAGNÓSTICO', 'NITROGÊNIO', 'BATERIA', 'MOTOR',
    'AR-CONDICIONADO', 'ELETRICA', 'EMBREAGEM', 'DIAGNOSTICO ELETRONICO',
    'OUTRO'
  ];

  const coresHex = {
    PRETO: '#000000', BRANCO: '#FFFFFF', CINZA: '#808080', VERMELHO: '#FF0000',
    AZUL: '#0000FF', VERDE: '#008000', AMARELO: '#FFFF00', ROSA: '#FFC0CB',
    LARANJA: '#FFA500', ROXO: '#800080'
  };

  const getTextoClaro = (c) =>
    c?.toLowerCase() === 'branco' || c?.toLowerCase() === 'amarelo';

  // -----------------------------------
  // render
  // -----------------------------------
  return (
    <div className="balcao-container">
      {/* animação para o destaque (blink) */}
      <style>{`
        @keyframes blinkCard {
          0%, 100% { box-shadow: 0 0 0px rgba(255,255,255,0.0); transform: scale(1.00); }
          50%       { box-shadow: 0 0 35px rgba(255,255,255,0.9); transform: scale(1.02); }
        }
        .destaque-card {
          animation: blinkCard 1s ease-in-out infinite;
        }
      `}</style>

      <div className="cadastro-section" aria-hidden={!!destaque}>
        <h1>🚗 Cadastro Rápido</h1>

        <form onSubmit={handleCadastro}>
          <input
            type="text"
            placeholder="Carro"
            value={modelo}
            onChange={(e) => setModelo(e.target.value.toUpperCase())}
          />

          <input
            type="text"
            placeholder="Placa"
            value={placa}
            minLength={7}
            maxLength={7}
            onChange={onChangePlaca}
          />

          <select value={cor} onChange={(e) => setCor(e.target.value)}>
            <option value="">Selecione a Cor</option>
            {cores.map((c, idx) => (
              <option key={idx} value={c}>{c}</option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Nº do movimento"
            value={numMovimento}
            onChange={(e) => setNumMovimento(e.target.value.toUpperCase())}
          />

          {/* serviço 1 + botão + */}
          <div className="servico-row">
            <select
              value={servicoSelects[0]}
              onChange={(e) => changeServicoSelect(0, e.target.value)}
            >
              <option value="">Selecione o Serviço</option>
              {servicosLista.map((s, idx) => (
                <option key={idx} value={s}>{s}</option>
              ))}
            </select>

            <button
              type="button"
              className="btn-add-servico"
              onClick={addServico}
              disabled={servicos.length >= 3}
              title={servicos.length >= 3 ? 'Máximo de 3 serviços' : 'Adicionar serviço'}
            >
              +
            </button>
          </div>

          {servicoSelects[0] === 'OUTRO' && (
            <input
              type="text"
              placeholder="Digite o serviço"
              value={servicos[0] || ''}
              onChange={(e) => changeServicoCustom(0, e.target.value)}
            />
          )}

          {/* serviços 2 e 3 */}
          {servicos.slice(1).map((_, i) => {
            const idx = i + 1;
            return (
              <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="servico-row">
                  <select
                    value={servicoSelects[idx] || ''}
                    onChange={(e) => changeServicoSelect(idx, e.target.value)}
                  >
                    <option value="">{`Serviço ${idx + 1} (opcional)`}</option>
                    {servicosLista.map((s, k) => (
                      <option key={k} value={s}>{s}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-remove-servico"
                    onClick={() => removeServico(idx)}
                    title="Remover serviço"
                  >
                    ×
                  </button>
                </div>

                {servicoSelects[idx] === 'OUTRO' && (
                  <input
                    type="text"
                    placeholder={`Digite o serviço ${idx + 1}`}
                    value={servicos[idx] || ''}
                    onChange={(e) => changeServicoCustom(idx, e.target.value)}
                  />
                )}
              </div>
            );
          })}

          <button type="submit">Cadastrar</button>
        </form>
      </div>

      <div className="fila-section" aria-hidden={!!destaque}>
        <h2>📋 Fila de Atendimento</h2>

        <div className="carros-grid">
          {carros.map((carro) => {
            const textoClaro = getTextoClaro(carro.cor);

            // Usa data_entrada_ms quando existir; senão tenta parsear
            const entradaMs = Number.isFinite(carro.data_entrada_ms)
              ? carro.data_entrada_ms
              : parseDbDateManaus(carro.data_entrada);

            const secs = Number.isFinite(entradaMs)
              ? Math.max(0, Math.floor((now - entradaMs) / 1000))
              : 0;

            const servicosTxt = [
              carro.servico, carro.servico2, carro.servico3
            ].filter(Boolean).join(' | ');

            return (
              <div
                key={carro.id}
                className="carro-card"
                style={{
                  backgroundColor: coresHex[carro.cor?.toUpperCase()] || '#2c5364',
                  color: textoClaro ? '#000' : '#fff'
                }}
              >
                {/* Linha 1: Modelo | Placa | Cor + MOV */}
                <p style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>
                  🚘 {String(carro.modelo || '').toUpperCase()}
                </p>
                <p style={{ fontSize: '1rem', fontWeight: 700 }}>
                  🏷️ {String(carro.placa || '').toUpperCase()}
                </p>
                <p>
                  <strong>Cor:</strong> {carro.cor}
                  {carro.num_movimento && (
                    <span style={{ marginLeft: 12 }}>
                      <strong>• MOV:</strong> {String(carro.num_movimento)}
                    </span>
                  )}
                </p>

                {/* Serviços (sem cortar) */}
                <p className="servicos-line">
                  <strong>Serviços:</strong> {servicosTxt || '-'}
                </p>

                {/* Entrada + Cronômetro */}
                <p><strong>Entrada:</strong> {formatHoraManaus(entradaMs)}</p>
                <p>⏳ {fmtHMS(secs)}</p>

                {/* Botão finalizar desabilitado se destaque ativo */}
                <button
                  onClick={() => confirmarFinalizar(carro.id)}
                  disabled={!!destaque}
                  style={{
                    opacity: destaque ? 0.6 : 1,
                    pointerEvents: destaque ? 'none' : 'auto'
                  }}
                >
                  Finalizar
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* modal confirmar finalizar */}
      {confirmandoId && (
        <div className="overlay-confirmacao">
          <div className="confirmacao-central">
            <p>Deseja realmente finalizar?</p>
            <div className="botoes-confirmacao">
              <button className="btn-sim" onClick={() => finalizarAtendimento(confirmandoId)}>
                Sim
              </button>
              <button className="btn-nao" onClick={cancelarFinalizar}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* destaque do carro finalizado (20s, piscando, bloqueando tudo) */}
      {!!destaque && (
        <div
          className="overlay-confirmacao"
          role="dialog"
          aria-modal="true"
          // sem onClick pra impedir fechar antes dos 20s
          style={{ cursor: 'not-allowed' }}
        >
          <div
            className="confirmacao-central destaque-card"
            // também evita cliques dentro encerrarem
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            style={{ maxWidth: 420, pointerEvents: 'none' }}
          >
            <p style={{ color: '#000', fontSize: 18, fontWeight: 800, marginBottom: 10 }}>
              ✅ Atendimento Finalizado
            </p>

            {(() => {
              const eMs = Number.isFinite(destaque.data_entrada_ms)
                ? destaque.data_entrada_ms
                : parseDbDateManaus(destaque.data_entrada);
              const sMs = parseDbDateManaus(destaque.data_saida);
              const dur = (Number.isFinite(eMs) && Number.isFinite(sMs))
                ? Math.max(0, Math.floor((sMs - eMs) / 1000))
                : null;

              const servTxt = [destaque.servico, destaque.servico2, destaque.servico3]
                .filter(Boolean).join(' | ');

              return (
                <div style={{ textAlign: 'left', color: '#000' }}>
                  <div><strong>Modelo:</strong> {String(destaque.modelo || '').toUpperCase()}</div>
                  <div><strong>Placa:</strong> {String(destaque.placa || '').toUpperCase()}</div>
                  <div><strong>Cor:</strong> {destaque.cor}</div>
                  <div style={{ whiteSpace: 'normal', overflow: 'visible' }}>
                    <strong>Serviços:</strong> {servTxt || '-'}
                  </div>
                  <div><strong>Entrada:</strong> {formatHoraManaus(eMs)}</div>
                  <div><strong>Saída:</strong> {formatHoraManaus(sMs)}</div>
                  <div><strong>Duração:</strong> {dur != null ? fmtHMS(dur) : '-'}</div>
                </div>
              );
            })()}

            {/* sem botão OK; some sozinho em 20s */}
          </div>
        </div>
      )}

      {/* modal de alerta (erro/sucesso) */}
      {!!alerta && (
        <div className="overlay-confirmacao" onClick={() => setAlerta(null)}>
          <div
            className={`confirmacao-central ${alerta.tipo === 'sucesso' ? 'modal-sucesso' : 'modal-erro'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ color: '#000', whiteSpace: 'pre-line' }}>{alerta.texto}</p>
            <div className="botoes-confirmacao">
              <button className="btn-sim" onClick={() => setAlerta(null)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
