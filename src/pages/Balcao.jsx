import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './Balcao.css';

const Balcao = () => {
  const [placa, setPlaca] = useState('');
  const [modelo, setModelo] = useState('');
  const [cor, setCor] = useState('');
  const [servico, setServico] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [tipoMensagem, setTipoMensagem] = useState('');
  const [carros, setCarros] = useState([]);
  const [confirmandoId, setConfirmandoId] = useState(null);

  const cores = [
    'PRETO', 'BRANCO', 'CINZA', 'VERMELHO', 'AZUL',
    'VERDE', 'AMARELO', 'ROSA', 'LARANJA', 'ROXO'
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
    ROXO: '#800080'
  };

  const servicos = [
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
    'OUTRO'
  ];

  const buscarCarros = async () => {
    try {
      const res = await axios.get('https://recepcaopneuforte.onrender.com/api/fila-servico');
      setCarros(res.data);
    } catch (error) {
      console.error('Erro ao buscar carros:', error);
    }
  };

  const handleCadastro = async (e) => {
    e.preventDefault();
    if (!placa || !modelo || !cor || !servico) {
      setMensagem('Preencha todos os campos.');
      setTipoMensagem('erro');
      return;
    }

    try {
      await axios.post('https://recepcaopneuforte.onrender.com/api/cadastrar-carro', {
        placa,
        modelo,
        cor,
        servico
      });
      setMensagem('Carro cadastrado com sucesso!');
      setTipoMensagem('sucesso');
      setPlaca('');
      setModelo('');
      setCor('');
      setServico('');
      buscarCarros();
    } catch (error) {
      console.error('Erro ao cadastrar carro:', error);
      setMensagem('Erro ao cadastrar o carro.');
      setTipoMensagem('erro');
    }
  };

  const confirmarFinalizar = (id) => {
    setConfirmandoId(id);
  };

  const cancelarFinalizar = () => {
    setConfirmandoId(null);
  };

  const finalizarAtendimento = async (id) => {
    try {
      await axios.put(`https://recepcaopneuforte.onrender.com/api/finalizar-carro/${id}`);
      setConfirmandoId(null);
      buscarCarros();
    } catch (error) {
      console.error('Erro ao finalizar carro:', error);
    }
  };

  useEffect(() => {
    buscarCarros();
    const intervalo = setInterval(buscarCarros, 5000);
    return () => clearInterval(intervalo);
  }, []);

  const getTextoClaro = (cor) => {
    return cor.toLowerCase() === 'branco' || cor.toLowerCase() === 'amarelo';
  };

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

          <select value={servico} onChange={(e) => setServico(e.target.value.toUpperCase())}>
            <option value="">Selecione o Serviço</option>
            {servicos.map((s, idx) => (
              <option key={idx} value={s}>{s}</option>
            ))}
          </select>

          {servico === 'OUTRO' && (
            <input
              type="text"
              placeholder="Digite o serviço"
              onChange={(e) => setServico(e.target.value.toUpperCase())}
            />
          )}

          <button type="submit">Cadastrar</button>
        </form>

        {mensagem && (
          <p className={`mensagem ${tipoMensagem === 'erro' ? 'erro' : 'sucesso'}`}>
            {mensagem}
          </p>
        )}
      </div>

      <div className="fila-section">
        <h2>📋 Fila de Atendimento</h2>
        <div className="carros-grid">
          {carros.map((carro) => {
            const textoClaro = getTextoClaro(carro.cor);
            return (
              <div
                key={carro.id}
                className="carro-card"
                style={{
                  backgroundColor: coresHex[carro.cor.toUpperCase()] || '#2c5364',
                  color: textoClaro ? '#000' : '#fff',
                }}
              >
                <p style={{ fontSize: '1.4rem', fontWeight: 'bold' }}>
                  🚘 {carro.modelo.toUpperCase()}
                </p>
                <p style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                  🏷️ Placa: {carro.placa.toUpperCase()}
                </p>
                <p><strong>Cor:</strong> {carro.cor}</p>
                <p><strong>Serviço:</strong> {carro.servico}</p>
                <p><strong>Entrada:</strong> {new Date(carro.data_entrada).toLocaleTimeString()}</p>
                <button onClick={() => confirmarFinalizar(carro.id)}>Finalizar</button>
              </div>
            );
          })}
        </div>
      </div>

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
    </div>
  );
};

export default Balcao;
