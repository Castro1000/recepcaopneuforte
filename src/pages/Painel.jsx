import './Painel.css';
import axios from 'axios';
import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

// use o que preferir:
// const API_BASE = 'http://localhost:3001';
const API_BASE = 'https://recepcaopneuforte.onrender.com';

// de fora do componente para não reconectar toda hora
const socket = io(API_BASE);

export default function Painel() {
  const [fila, setFila] = useState([]);
  const [carroAtual, setCarroAtual] = useState(0);
  const [carroFinalizado, setCarroFinalizado] = useState(null);
  const [emDestaque, setEmDestaque] = useState(false);

  const intervaloRef = useRef(null);
  const timeoutDestaqueRef = useRef(null);
  const fallbackEncadeamentoRef = useRef(null);

  // -------- helpers --------
  const corrigirPronunciaModelo = (modelo) => {
    const m = (modelo || '').toString().trim();
    const upper = m.toUpperCase();
    switch (upper) {
      case 'KWID': return 'cuidi';
      case 'BYD': return 'biu ai díi';
      case 'HB20': return 'agá bê vinte';
      case 'ONIX': return 'ônix';
      case 'T-CROSS': return 'tê cross';
      case 'HR-V': return 'agá érre vê';
      case 'CR-V': return 'cê érre vê';
      case 'FERRARI': return 'FÉRRARI';
      default: return m;
    }
  };

  const montaServicos = (c) =>
    [c?.servico, c?.servico2, c?.servico3].filter(Boolean).join(' | ');

  const buscarFila = async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/api/fila-servico`);
      if (Array.isArray(data)) setFila(data.slice(0, 7));
      else console.error('A resposta da API não é um array:', data);
    } catch (err) {
      console.error('Erro ao buscar fila:', err);
    }
  };

  // 1) carga inicial
  useEffect(() => {
    buscarFila();
  }, []);

  // 2) carrossel rotativo (pausa quando tem destaque)
  useEffect(() => {
    if (intervaloRef.current) clearInterval(intervaloRef.current);

    if (fila.length > 1 && !carroFinalizado) {
      intervaloRef.current = setInterval(() => {
        setCarroAtual((prev) => (prev + 1) % fila.length);
      }, 6000);
    } else {
      setCarroAtual(0);
    }

    return () => clearInterval(intervaloRef.current);
  }, [fila, carroFinalizado]);

  // ---- TTS via backend ----
  const tocarTTS = async (carro) => {
    try {
      const ajustarLetra = (letra) => {
        const mapa = { Q: 'quê', W: 'dáblio', Y: 'ípsilon', E: 'é' };
        return mapa[letra.toUpperCase()] || letra.toUpperCase();
      };
      const placaSeparada = (carro.placa || '')
        .toString()
        .toUpperCase()
        .split('')
        .map(ajustarLetra)
        .join(' ');

      const modeloCorrigido = corrigirPronunciaModelo(carro.modelo);
      const frase = `Carro ${modeloCorrigido}, placa ${placaSeparada}, cor ${carro.cor}, dirija-se ao caixa.`;

      const urlTTS = `${API_BASE}/api/tts?text=${encodeURIComponent(frase)}`;
      const audioTTS = new Audio(urlTTS);
      audioTTS.volume = 1.0;
      await audioTTS.play();
    } catch (e) {
      console.warn('Falha ao tocar TTS:', e);
    }
  };

  // 3) sockets: finalização + novo carro (REGISTRA UMA VEZ)
  useEffect(() => {
    const onCarroFinalizado = (carro) => {
      setCarroFinalizado(carro);
      setEmDestaque(true);

      // sons
      const busina1 = new Audio('/busina.mp3');
      const motor = new Audio('/motor.mp3');
      const freiada = new Audio('/freiada.mp3');
      const busina2 = new Audio('/busina.mp3');

      // util: tocar e ignorar erro de autoplay
      const tryPlay = (aud) => aud.play().catch(() => {});

      try {
        // toca motor + buzina curta juntos
        tryPlay(motor);
        tryPlay(busina1);

        // agenda freiada no meio do motor (fallback caso duration não venha)
        motor.onloadedmetadata = () => {
          const meioMs = Math.max(1000, (motor.duration / 2) * 1000);
          setTimeout(() => tryPlay(freiada), meioMs);
        };
        // se onloadedmetadata não disparar na TV, dispara freiada após 2.5s
        setTimeout(() => tryPlay(freiada), 2500);

        // quando motor terminar, toca buzina 2 e depois TTS
        const seguirParaBuzina2 = () => {
          tryPlay(busina2);

          // quando buzina2 terminar, fala TTS
          busina2.onended = () => {
            tocarTTS(carro);

            // fallback: se onended falhar, chama TTS de qualquer jeito após 1.2s
            fallbackEncadeamentoRef.current = setTimeout(() => tocarTTS(carro), 1200);
          };

          // fallback extra: se onended da buzina2 não disparar, chama TTS em 3s
          setTimeout(() => tocarTTS(carro), 3000);
        };

        motor.onended = seguirParaBuzina2;

        // fallback caso onended do motor nunca venha (alguns Tizen): chama buzina2 em 4s
        setTimeout(seguirParaBuzina2, 4000);
      } catch (e) {
        console.warn('Erro no áudio/fala:', e);
      }

      // remove da fila e ajusta índice
      setFila((prev) => {
        const nova = prev.filter((c) => c.id !== carro.id);
        setCarroAtual((idx) => (idx >= nova.length ? 0 : idx));
        return nova;
      });

      // mantém o destaque por 30s e garante limpeza
      if (timeoutDestaqueRef.current) clearTimeout(timeoutDestaqueRef.current);
      timeoutDestaqueRef.current = setTimeout(() => {
        setCarroFinalizado(null);
        setEmDestaque(false);
      }, 30000); // 30s
    };

    const onNovoCarroAdicionado = () => buscarFila();

    socket.on('carroFinalizado', onCarroFinalizado);
    socket.on('novoCarroAdicionado', onNovoCarroAdicionado);

    return () => {
      socket.off('carroFinalizado', onCarroFinalizado);
      socket.off('novoCarroAdicionado', onNovoCarroAdicionado);
      if (timeoutDestaqueRef.current) clearTimeout(timeoutDestaqueRef.current);
      if (fallbackEncadeamentoRef.current) clearTimeout(fallbackEncadeamentoRef.current);
    };
  }, []); // <-- registra listeners só 1x

  // 4) Guard extra: se por algum motivo carroFinalizado sumir, desliga overlay
  useEffect(() => {
    if (!carroFinalizado && emDestaque) setEmDestaque(false);
  }, [carroFinalizado, emDestaque]);

  const carroDestaque = carroFinalizado || fila[carroAtual];

  return (
    <div className="painel">
      <div className="topo">
        {/* ESQUERDA: logo */}
        <div className="titulo" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img
            src="/img/logo_pneuforte.png"
            alt="Pneu Forte"
            style={{ height: 65, objectFit: 'contain' }}
          />
        </div>

        {/* DIREITA: título */}
        <div
          className="previsao"
          style={{
            fontSize: '3rem',
            fontWeight: 800,
            letterSpacing: '2px',
            textTransform: 'uppercase',
            textShadow: '0 0 10px cyan'
          }}
        >
          LISTA DE ESPERA
        </div>
      </div>

      <div className="conteudo">
        <div className={`principal ${emDestaque ? 'destaque-finalizado' : ''}`}>
          {carroDestaque ? (
            <div className="conteudo-finalizado">
              <img
                src={carroFinalizado ? '/img/finalizado.gif' : '/img/carro_pneu_forte.png'}
                alt="Carro"
                className="imagem-principal"
              />
              <div className="info-carro">
                {carroFinalizado && (
                  <div className="texto-finalizado">🚗 CARRO FINALIZADO ✅</div>
                )}
                <h2>{carroDestaque.modelo?.toUpperCase()}</h2>
                <p>🔖 Placa: {carroDestaque.placa}</p>
                <p>🎨 Cor: {carroDestaque.cor}</p>
                <p>🔧 Serviços: {montaServicos(carroDestaque) || '-'}</p>
              </div>
            </div>
          ) : (
            <div className="conteudo-finalizado">
              <img
                src="/img/carro_pneu_forte.png"
                alt="Carro"
                className="imagem-principal"
              />
              <div className="info-carro">
                <h2>Sem carros na fila</h2>
              </div>
            </div>
          )}
        </div>

        <div className="lista-lateral">
          {fila.map((carro, index) =>
            index !== carroAtual ? (
              <div key={carro.id} className="card-lateral">
                <img src="/img/carro_pneu_forte.png" alt="Carro" className="miniatura" />
                <div>
                  <h3> 🚘 {carro.modelo?.toUpperCase()} 🚘</h3>
                  <p> 🔖 Placa: {carro.placa}</p>
                  <p> 🔧 Serviços: {montaServicos(carro) || '-'}</p>
                </div>
              </div>
            ) : null
          )}
        </div>
      </div>

      <div className="parceiros">
        <div className="lista-parceiros">
          <div className="logos-scroll">
            {[...Array(2)].flatMap((_, i) => [
              <img key={`p1-${i}`} src="/img/logo_parceiro1.png" alt="Parceiro 1" className="logo-parceiro" />,
              <img key={`p2-${i}`} src="/img/logo_parceiro2.png" alt="Parceiro 2" className="logo-parceiro" />,
              <img key={`p3-${i}`} src="/img/logo_parceiro3.png" alt="Parceiro 3" className="logo-parceiro" />,
              <img key={`p4-${i}`} src="/img/logo_parceiro4.png" alt="Parceiro 4" className="logo-parceiro" />,
              <img key={`p5-${i}`} src="/img/logo_parceiro5.png" alt="Parceiro 5" className="logo-parceiro" />,
              <img key={`p6-${i}`} src="/img/logo_parceiro6.png" alt="Parceiro 6" className="logo-parceiro" />,
              <img key={`p7-${i}`} src="/img/logo_parceiro7.png" alt="Parceiro 7" className="logo-parceiro" />,
              <img key={`p8-${i}`} src="/img/logo_parceiro8.png" alt="Parceiro 8" className="logo-parceiro" />,
              <img key={`p9-${i}`} src="/img/logo_parceiro9.jpg" alt="Parceiro 9" className="logo-parceiro" />,
              <img key={`p10-${i}`} src="/img/logo_parceiro10.png" alt="Parceiro 10" className="logo-parceiro" />,
              <img key={`p11-${i}`} src="/img/logo_parceiro11.jpg" alt="Parceiro 11" className="logo-parceiro" />,
            ])}
          </div>
        </div>
      </div>
    </div>
  );
}
