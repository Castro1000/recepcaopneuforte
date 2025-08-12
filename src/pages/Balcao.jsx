import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import './Balcao.css';

const API_BASE = 'http://localhost:3001';
// const API_BASE = 'https://recepcaopneuforte.onrender.com';

const MEDIA_FALLBACK_MIN = 2; // média padrão (minutos) quando não temos histórico

export default function Balcao() {
  // ------- form -------
  const [placa, setPlaca] = useState('');
  const [modelo, setModelo] = useState('');
  const [cor, setCor] = useState('');
  const [numMovimento, setNumMovimento] = useState('');

  // serviços dinâmicos: selects (pode ser OUTRO) e valores finais (texto)
  const [servicoSelects, setServicoSelects] = useState(['']);
  const [servicos, setServicos] = useState(['']);

  // ------- dados / ui -------
  const [carros, setCarros] = useState([]);
  const [confirmandoId, setConfirmandoId] = useState(null);
  const [alerta, setAlerta] = useState(null); // {tipo:'erro'|'sucesso', texto:'..'}

  // cronômetro global (1s)
  const [now, setNow] = useState(Date.now());

  // médias (se quiser, depois popular via backend)
  const [mediasServ, setMediasServ] = useState({}); // { 'ALINHAMENTO': 25, ... } em minutos
  const [mediaGlobal, setMediaGlobal] = useState(MEDIA_FALLBACK_MIN);

  // toasts
  const [toasts, setToasts] = useState([]);
  const pushToast = (txt, type = 'warning') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, txt, type }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4500);
  };

  // controle de avisos por carro (máx 3, espaçamento 5min)
  const warnInfoRef = useRef({}); // { [id]: { count: number, last: number } }

  // -----------------------------------
  // helpers de tempo e média
  // -----------------------------------
  const secondsSince = (ts) => {
    const t = new Date(ts).getTime();
    if (!Number.isFinite(t)) return 0;
    return Math.max(0, Math.floor((now - t) / 1000));
  };

  const fmtHMS = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
  };

  const fmtMinToHM = (min) => {
    if (min == null) return '-';
    const total = Math.round(min);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h ? `${h}h ${m}m` : `${m} min`;
  };

  const mediaPrevistaMin = (carro) => {
    const nomes = [carro.servico, carro.servico2, carro.servico3]
      .filter(Boolean)
      .map((s) => String(s).toUpperCase().trim());

    if (!nomes.length) {
      return typeof mediaGlobal === 'number' && mediaGlobal > 0
        ? mediaGlobal
        : MEDIA_FALLBACK_MIN;
    }

    return nomes.reduce((acc, nome) => {
      const m =
        typeof mediasServ[nome] === 'number' && mediasServ[nome] > 0
          ? mediasServ[nome]
          : typeof mediaGlobal === 'number' && mediaGlobal > 0
          ? mediaGlobal
          : MEDIA_FALLBACK_MIN;
      return acc + m;
    }, 0);
  };

  // -----------------------------------
  // efeitos
  // -----------------------------------
  // cronômetro global (1s)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // busca da fila
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

  // avisos de acima da média (checado todo segundo)
  useEffect(() => {
    carros.forEach((carro) => {
      const secs = secondsSince(carro.data_entrada);
      const mediaMin = mediaPrevistaMin(carro);
      const acima = secs > mediaMin * 60;

      if (!acima) return;

      const info = (warnInfoRef.current[carro.id] ||= { count: 0, last: 0 });
      const nowMs = Date.now();
      const cincoMin = 5 * 60 * 1000;

      if (info.count < 3 && nowMs - info.last >= cincoMin) {
        info.count += 1;
        info.last = nowMs;

        const servicosTxt = [carro.servico, carro.servico2, carro.servico3]
          .filter(Boolean)
          .join(' | ');

        pushToast(
          `Serviço acima da média: ${carro.modelo?.toUpperCase()} (${carro.placa?.toUpperCase()})\n` +
            `Serviços: ${servicosTxt}\n` +
            `Decorridos: ${fmtHMS(secs)}  •  Média: ${fmtMinToHM(mediaMin)}`,
          'warning'
        );
      }
    });
  }, [now, carros]); // reavalia a cada segundo

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
  const validarObrigatorios = () => {
    const faltas = [];
    if (!modelo.trim()) faltas.push('Carro');
    if (!placa.trim()) faltas.push('Placa');
    if (!cor.trim()) faltas.push('Cor');
    if (!numMovimento.trim()) faltas.push('Nº do movimento');
    const s1 = (servicos[0] || '').trim();
    if (!s1) faltas.push('Serviço (mínimo 1)');

    if (faltas.length) {
      setAlerta({
        tipo: 'erro',
        texto: `Preencha os campos obrigatórios:\n• ${faltas.join('\n• ')}`,
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
      servico3: (servicos[2] || '').trim() || null,
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
  const confirmarFinalizar = (id) => setConfirmandoId(id);
  const cancelarFinalizar = () => setConfirmandoId(null);

  const finalizarAtendimento = async (id) => {
    try {
      await axios.put(`${API_BASE}/api/finalizar-carro/${id}`);
      setConfirmandoId(null);
      buscarCarros();
      // limpa contadores de aviso do carro finalizado
      delete warnInfoRef.current[id];
    } catch (error) {
      console.error('Erro ao finalizar carro:', error);
    }
  };

  const cores = [
    'PRETO',
    'BRANCO',
    'CINZA',
    'VERMELHO',
    'AZUL',
    'VERDE',
    'AMARELO',
    'ROSA',
    'LARANJA',
    'ROXO',
  ];

  const servicosLista = [
    'TROCA DE OLEO',
    'TROCA DE PNEUS',
    'RODIZIO',
    'COMBO ALINHAMENTO E BALANCEAMENTO',
    'ALINHAMENTO',
    'REVISÃO GERAL DOS FILTROS',
    'REVISÃO',
    'CAMBAGEM',
    'CASTER',
    'CONSERTO',
    'MONTAGEM',
    'DIAGNÓSTICO',
    'NITROGÊNIO',
    'BATERIA',
    'MOTOR',
    'AR-CONDICIONADO',
    'ELETRICA',
    'EMBREAGEM',
    'DIAGNOSTICO ELETRONICO',
    'OUTRO',
  ];

  const coresHex = {
    PRETO: '#000000',
    BRANCO: '#FFFFFF',
    CINZA: '#808080',
    VERMELHO: '#FF0000',
    AZUL: '#0000FF',
    VERDE: '#008000',
    AMARELO: '#FFFF00',
    ROSA: '#FFC0CB',
    LARANJA: '#FFA500',
    ROXO: '#800080',
  };

  const getTextoClaro = (c) =>
    c?.toLowerCase() === 'branco' || c?.toLowerCase() === 'amarelo';

  // -----------------------------------
  // render
  // -----------------------------------
  return (
    <div className="balcao-container">
      <div className="cadastro-section">
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
            onChange={(e) => setPlaca(e.target.value.toUpperCase().slice(0, 7))}
          />

          <select value={cor} onChange={(e) => setCor(e.target.value)}>
            <option value="">Selecione a Cor</option>
            {cores.map((c, idx) => (
              <option key={idx} value={c}>
                {c}
              </option>
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
                <option key={idx} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="btn-add-servico"
              onClick={addServico}
              disabled={servicos.length >= 3}
              title={
                servicos.length >= 3
                  ? 'Máximo de 3 serviços'
                  : 'Adicionar serviço'
              }
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
              <div
                key={idx}
                style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                <div className="servico-row">
                  <select
                    value={servicoSelects[idx] || ''}
                    onChange={(e) => changeServicoSelect(idx, e.target.value)}
                  >
                    <option value="">{`Serviço ${idx + 1} (opcional)`}</option>
                    {servicosLista.map((s, k) => (
                      <option key={k} value={s}>
                        {s}
                      </option>
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

      <div className="fila-section">
        <h2>📋 Fila de Atendimento</h2>

        <div className="carros-grid">
          {carros.map((carro) => {
            const textoClaro = getTextoClaro(carro.cor);
            const secs = secondsSince(carro.data_entrada);
            const mediaMin = mediaPrevistaMin(carro);

            const servicosTxt = [
              carro.num_movimento ? `MOV:${carro.num_movimento}` : null,
              carro.servico,
              carro.servico2,
              carro.servico3,
            ]
              .filter(Boolean)
              .join(' | ');

            return (
              <div
                key={carro.id}
                className="carro-card"
                style={{
                  backgroundColor:
                    coresHex[carro.cor?.toUpperCase()] || '#2c5364',
                  color: textoClaro ? '#000' : '#fff',
                }}
              >
                {/* botão de tempo no canto */}
                <button
                  className="btn-tempo"
                  title="Tempo / Média"
                  onClick={() =>
                    pushToast(
                      `${carro.modelo?.toUpperCase()} (${carro.placa?.toUpperCase()})\n` +
                        `Decorridos: ${fmtHMS(secs)}  •  Média: ${fmtMinToHM(
                          mediaMin
                        )}`,
                      'info'
                    )
                  }
                >
                  ⏱
                </button>

                <p style={{ fontSize: '1.4rem', fontWeight: 'bold' }}>
                  🚘 {String(carro.modelo || '').toUpperCase()}
                </p>
                <p style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                  🏷️ Placa: {String(carro.placa || '').toUpperCase()}
                </p>
                <p>
                  <strong>Cor:</strong> {carro.cor}
                </p>
                <p
                  style={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={servicosTxt}
                >
                  <strong>Serviços:</strong> {servicosTxt || '-'}
                </p>
                <p>
                  <strong>Entrada:</strong>{' '}
                  {new Date(carro.data_entrada).toLocaleTimeString()}
                </p>

                {/* cronômetro + média em hh:mm:ss / h m */}
                <p>
                  ⏳ {fmtHMS(secs)} / {fmtMinToHM(mediaMin)}
                </p>

                <button onClick={() => confirmarFinalizar(carro.id)}>
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
              <button
                className="btn-sim"
                onClick={() => finalizarAtendimento(confirmandoId)}
              >
                Sim
              </button>
              <button className="btn-nao" onClick={cancelarFinalizar}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* modal de alerta (erro/sucesso) */}
      {!!alerta && (
        <div className="overlay-confirmacao" onClick={() => setAlerta(null)}>
          <div
            className={`confirmacao-central ${
              alerta.tipo === 'sucesso' ? 'modal-sucesso' : 'modal-erro'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ color: '#000', whiteSpace: 'pre-line' }}>
              {alerta.texto}
            </p>
            <div className="botoes-confirmacao">
              <button className="btn-sim" onClick={() => setAlerta(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* toasts de aviso */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.type === 'warning' ? 'toast-warning' : ''}`}
          >
            {t.txt.split('\n').map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
