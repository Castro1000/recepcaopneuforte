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

  // áudio
  const [audioOk, setAudioOk] = useState(false);          // liberado?
  const [pendenteAnuncio, setPendenteAnuncio] = useState(null); // anunciar depois que liberar

  const intervaloRef = useRef(null);
  const timeoutDestaqueRef = useRef(null);
  const fallbackEncadeamentoRef = useRef(null);
  const btnAtivarRef = useRef(null);

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

  // --- sequência de sons + TTS (reutilizável) ---
  const rodarSequenciaAudio = (carro) => {
    const busina1 = new Audio('/busina.mp3');
    const motor   = new Audio('/motor.mp3');
    const freiada = new Audio('/freiada.mp3');
    const busina2 = new Audio('/busina.mp3');

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
      // fallback se onloadedmetadata não disparar (alguns Tizen)
      setTimeout(() => tryPlay(freiada), 2500);

      const seguirParaBuzina2 = () => {
        tryPlay(busina2);

        // quando buzina2 terminar, fala TTS
        busina2.onended = () => {
          tocarTTS(carro);
          // fallback: se onended falhar, chama TTS mesmo assim
          fallbackEncadeamentoRef.current = setTimeout(() => tocarTTS(carro), 1200);
        };

        // fallback extra: se onended da buzina2 não disparar
        setTimeout(() => tocarTTS(carro), 3000);
      };

      motor.onended = seguirParaBuzina2;
      // fallback se onended do motor nunca vier
      setTimeout(seguirParaBuzina2, 4000);
    } catch (e) {
      console.warn('Erro no áudio/fala:', e);
    }
  };

  // 3) sockets: finalização + novo carro (REGISTRA UMA VEZ)
  useEffect(() => {
    const onCarroFinalizado = (carro) => {
      setCarroFinalizado(carro);
      setEmDestaque(true);

      // se áudio não liberado ainda, deixa o anúncio pendente
      if (!audioOk) {
        setPendenteAnuncio(carro);
      } else {
        rodarSequenciaAudio(carro);
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
  }, [audioOk]); // se audioOk mudar, futuros eventos já estão liberados

  // 4) quando liberar o áudio e houver anúncio pendente, roda a sequência
  useEffect(() => {
    if (audioOk && pendenteAnuncio) {
      const carro = pendenteAnuncio;
      setPendenteAnuncio(null);
      rodarSequenciaAudio(carro);
    }
  }, [audioOk, pendenteAnuncio]);

  // 5) Guard extra: se por algum motivo carroFinalizado sumir, desliga overlay
  useEffect(() => {
    if (!carroFinalizado && emDestaque) setEmDestaque(false);
  }, [carroFinalizado, emDestaque]);

  // 6) Overlay "Ativar som"
  useEffect(() => {
    // foco no botão para aceitar ENTER/OK do controle imediatamente
    if (!audioOk && btnAtivarRef.current) {
      try { btnAtivarRef.current.focus(); } catch {}
    }
    const onKey = (e) => {
      if (!audioOk && (e.key === 'Enter' || e.code === 'Enter' || e.keyCode === 13)) {
        e.preventDefault();
        handleAtivarSom();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioOk]);

  const handleAtivarSom = async () => {
    try {
      // tenta destravar tocando um áudio curtinho quase mudo
      const test = new Audio('/busina.mp3');
      test.volume = 0.01;
      await test.play();
      test.pause();
      test.currentTime = 0;

      // tenta também acordar o WebAudio (alguns navegadores exigem)
      if (window.AudioContext || window.webkitAudioContext) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.0001;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.01);
      }

      setAudioOk(true);
    } catch (e) {
      console.warn('Falha ao liberar áudio, tente novamente:', e);
      // tenta de novo com outro arquivo
      try {
        const test2 = new Audio('/freiada.mp3');
        test2.volume = 0.01;
        await test2.play();
        test2.pause();
        test2.currentTime = 0;
        setAudioOk(true);
      } catch {
        // se falhar, mantém overlay visível
      }
    }
  };

  const carroDestaque = carroFinalizado || fila[carroAtual];

  return (
    <div className="painel">
      {/* OVERLAY ATIVAR SOM */}
      {!audioOk && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.88)',
            color: '#0ff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 20000,
            padding: 24,
            textAlign: 'center'
          }}
        >
          <div
            role="button"
            tabIndex={0}
            onClick={handleAtivarSom}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAtivarSom();
            }}
            ref={btnAtivarRef}
            style={{
              border: '2px solid cyan',
              borderRadius: 16,
              padding: '28px 36px',
              outline: 'none',
              boxShadow: '0 0 20px cyan',
              maxWidth: 800
            }}
          >
            <div style={{ fontSize: '2.2rem', fontWeight: 800, marginBottom: 12 }}>
              ⚠️ Ativar som
            </div>
            <div style={{ fontSize: '1.6rem', marginBottom: 24, color: '#e0ffff' }}>
              Para liberar o áudio nesta TV, pressione <strong>OK</strong> no controle
              remoto (ou Enter). Isso é necessário apenas na primeira abertura.
            </div>
            <button
              style={{
                fontSize: '1.8rem',
                fontWeight: 900,
                background: 'cyan',
                color: '#000',
                border: 'none',
                borderRadius: 12,
                padding: '14px 22px',
                cursor: 'pointer'
              }}
            >
              Ativar agora (OK)
            </button>
          </div>
        </div>
      )}

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
