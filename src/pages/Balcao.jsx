import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './Balcao.css';

//const API_BASE = 'http://localhost:3001';
const API_BASE = 'https://recepcaopneuforte.onrender.com';

const Balcao = () => {
  const [placa, setPlaca] = useState('');
  const [modelo, setModelo] = useState('');
  const [cor, setCor] = useState('');
  const [numMovimento, setNumMovimento] = useState(''); // OBRIGATÓRIO

  // serviços dinâmicos
  // servicoSelects: valor do select (pode ser OUTRO)
  // servicos: valor final (se OUTRO, vem do input)
  const [servicoSelects, setServicoSelects] = useState(['']);
  const [servicos, setServicos] = useState(['']);

  const [carros, setCarros] = useState([]);
  const [confirmandoId, setConfirmandoId] = useState(null);

  // Modal de alerta (erro/sucesso)
  // { tipo: 'erro'|'sucesso', texto: '...' }
  const [alerta, setAlerta] = useState(null);

  const cores = ['PRETO','BRANCO','CINZA','VERMELHO','AZUL','VERDE','AMARELO','ROSA','LARANJA','ROXO'];

  const coresHex = {
    PRETO:'#000000', BRANCO:'#FFFFFF', CINZA:'#808080', VERMELHO:'#FF0000',
    AZUL:'#0000FF', VERDE:'#008000', AMARELO:'#FFFF00', ROSA:'#FFC0CB',
    LARANJA:'#FFA500', ROXO:'#800080'
  };

  const servicosLista = [
    'TROCA DE OLEO','TROCA DE PNEUS','RODIZIO',
    'COMBO ALINHAMENTO E BALANCEAMENTO','ALINHAMENTO',
    'REVISÃO GERAL DOS FILTROS','REVISÃO','CAMBAGEM','CASTER','CONSERTO',
    'MONTAGEM','DIAGNÓSTICO','NITROGÊNIO','BATERIA','MOTOR',
    'AR-CONDICIONADO','ELETRICA','EMBREAGEM','DIAGNOSTICO ELETRONICO',
    'OUTRO'
  ];

  const buscarCarros = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/fila-servico`);
      setCarros(res.data);
    } catch (error) {
      console.error('Erro ao buscar carros:', error);
    }
  };

  useEffect(() => {
    buscarCarros();
    const i = setInterval(buscarCarros, 5000);
    return () => clearInterval(i);
  }, []);

  // ---- serviços dinâmicos ----
  const addServico = () => {
    if (servicos.length >= 3) return;
    setServicoSelects(prev => [...prev, '']);
    setServicos(prev => [...prev, '']);
  };

  const removeServico = (idx) => {
    setServicoSelects(prev => prev.filter((_, i) => i !== idx));
    setServicos(prev => prev.filter((_, i) => i !== idx));
  };

  const changeServicoSelect = (idx, value) => {
    const v = (value || '').toUpperCase();
    setServicoSelects(prev => prev.map((s, i) => (i === idx ? v : s)));
    // OUTRO -> deixa o campo final vazio para digitar manual
    setServicos(prev => prev.map((s, i) => (i === idx ? (v === 'OUTRO' ? '' : v) : s)));
  };

  const changeServicoCustom = (idx, value) => {
    const v = (value || '').toUpperCase();
    setServicos(prev => prev.map((s, i) => (i === idx ? v : s)));
  };

  // Validação obrigatória com modal
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
      servico3: (servicos[2] || '').trim() || null,
    };

    try {
      await axios.post(`${API_BASE}/api/cadastrar-carro`, payload);

      // limpa form
      setPlaca(''); setModelo(''); setCor(''); setNumMovimento('');
      setServicoSelects(['']); setServicos(['']);

      setAlerta({ tipo: 'sucesso', texto: 'Carro cadastrado com sucesso!' });
      buscarCarros();
    } catch (error) {
      console.error('Erro ao cadastrar carro:', error);
      setAlerta({ tipo: 'erro', texto: 'Erro ao cadastrar o carro.' });
    }
  };

  const confirmarFinalizar = (id) => setConfirmandoId(id);
  const cancelarFinalizar = () => setConfirmandoId(null);

  const finalizarAtendimento = async (id) => {
    try {
      await axios.put(`${API_BASE}/api/finalizar-carro/${id}`);
      setConfirmandoId(null);
      buscarCarros();
    } catch (error) {
      console.error('Erro ao finalizar carro:', error);
    }
  };

  const getTextoClaro = (c) =>
    c.toLowerCase() === 'branco' || c.toLowerCase() === 'amarelo';

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
            onChange={(e) => setPlaca(e.target.value.toUpperCase())}
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

          {/* Serviço 1 + botão de adicionar */}
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

          {/* OUTRO do 1º serviço -> input vazio */}
          {servicoSelects[0] === 'OUTRO' && (
            <input
              type="text"
              placeholder="Digite o serviço"
              value={servicos[0] || ''}
              onChange={(e) => changeServicoCustom(0, e.target.value)}
            />
          )}

          {/* Serviços 2 e 3 (opcionais) */}
          {servicos.slice(1).map((val, i) => {
            const idx = i + 1; // 1 ou 2
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

      <div className="fila-section">
        <h2>📋 Fila de Atendimento</h2>
        <div className="carros-grid">
          {carros.map((carro) => {
            const textoClaro = getTextoClaro(carro.cor);

            // MOV:123 | SERV1 | SERV2 | SERV3
            const servicosTxt = [
              carro.num_movimento ? `MOV:${carro.num_movimento}` : null,
              carro.servico,
              carro.servico2,
              carro.servico3
            ]
              .filter(Boolean)
              .join(' | ');

            return (
              <div
                key={carro.id}
                className="carro-card"
                style={{
                  backgroundColor: coresHex[carro.cor?.toUpperCase()] || '#2c5364',
                  color: textoClaro ? '#000' : '#fff',
                }}
              >
                <p style={{ fontSize: '1.4rem', fontWeight: 'bold' }}>
                  🚘 {String(carro.modelo || '').toUpperCase()}
                </p>
                <p style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                  🏷️ Placa: {String(carro.placa || '').toUpperCase()}
                </p>
                <p><strong>Cor:</strong> {carro.cor}</p>
                <p style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <strong>Serviços:</strong> {servicosTxt || '-'}
                </p>
                <p><strong>Entrada:</strong> {new Date(carro.data_entrada).toLocaleTimeString()}</p>
                <button onClick={() => confirmarFinalizar(carro.id)}>Finalizar</button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal confirmar finalizar */}
      {confirmandoId && (
        <div className="overlay-confirmacao">
          <div className="confirmacao-central">
            <p>Deseja realmente finalizar?</p>
            <div className="botoes-confirmacao">
              <button className="btn-sim" onClick={() => finalizarAtendimento(confirmandoId)}>Sim</button>
              <button className="btn-nao" onClick={cancelarFinalizar}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de alerta (erro/sucesso) */}
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
};

export default Balcao;
