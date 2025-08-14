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

  // áudio / overlay
  const [audioOk, setAudioOk] = useState(false);
  const [pendenteAnuncio, setPendenteAnuncio] = useState(null);

  const intervaloRef = useRef(null);
  const timeoutDestaqueRef = useRef(null);
  const fallbackEncadeamentoRef = useRef(null);

  // Refs dos áudios para pré-carregar e reutilizar
  const busina1Ref = useRef(null);
  const motorRef   = useRef(null);
  const freiadaRef = useRef(null);
  const busina2Ref = useRef(null);

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

  // 0) Pré-carrega os áudios
  useEffect(() => {
    busina1Ref.current = new Audio('/busina.mp3');
    motorRef.current   = new Audio('/motor.mp3');
    freiadaRef.current = new Audio('/freiada.mp3');
    busina2Ref.current = new Audio('/busina.mp3');

    // pedimos para pré-carregar
    [busina1Ref, motorRef, freiadaRef, busina2Ref].forEach(r => {
      try {
        r.current.preload = 'auto';
        r.current.load();
      } catch {}
    });
  }, []);

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

  // ---- TTS via backend (/api/tts?text=...) ----
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
      console.warn('Falha ao tocar TTS (verifique /api/tts no backend):', e);
    }
  };

  // --- sequência de sons + TTS ---
  const rodarSequenciaAudio = (carro) => {
    const busina1 = busina1Ref.current;
    const motor   = motorRef.current;
    const freiada = freiadaRef.current;
    const busina2 = busina2Ref.current;

    const safePlay = (a) => a && a.play().catch(() => {});

    try {
      // garante volumes normais
      [busina1, motor, freiada, busina2].forEach(a => { if (a) a.volume = 1.0; });

      // reinicia os tempos
      [busina1, motor, freiada, busina2].forEach(a => { try { a.currentTime = 0; } catch {} });

      // toca motor + buzina curta juntos
      safePlay(motor);
      safePlay(busina1);

      // agenda freiada no meio do motor (fallback caso duration não venha)
      if (motor) {
        motor.onloadedmetadata = () => {
          const meioMs = Math.max(1000, (motor.duration / 2) * 1000);
          setTimeout(() => safePlay(freiada), meioMs);
        };
        // fallback se metadata não vier
        setTimeout(() => safePlay(freiada), 2500);
      } else {
        safePlay(freiada);
      }

      const seguirParaBuzina2 = () => {
        safePlay(busina2);

        // quando buzina2 terminar, fala TTS
        if (busina2) {
          busina2.onended = () => {
            tocarTTS(carro);
            // fallback: se onended falhar, chama TTS mesmo assim
            fallbackEncadeamentoRef.current = setTimeout(() => tocarTTS(carro), 1000);
          };
          // fallback extra: se onended da buzina2 não disparar
          setTimeout(() => tocarTTS(carro), 3000);
        } else {
          tocarTTS(carro);
        }
      };

      if (motor) {
        motor.onended = seguirParaBuzina2;
        // fallback se onended do motor nunca vier
        setTimeout(seguirParaBuzina2, 4000);
      } else {
        seguirParaBuzina2();
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioOk]); // quando audioOk mudar, futuros eventos já estão liberados

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

  // 6) Overlay “Ativar som”
  useEffect(() => {
    if (audioOk) return;

    const activate = () => handleAtivarSom();

    // captura o máximo possível de eventos de controle remoto
    const handlers = [
      ['keydown', (e) => {
        const k = (e.key || '').toLowerCase();
        if (['enter', 'ok', ' ', 'spacebar'].includes(k) || e.keyCode === 13 || e.code === 'Enter') {
          e.preventDefault();
          activate();
        } else {
          // Qualquer tecla libera também (algumas TVs mandam códigos estranhos)
          activate();
        }
      }, { capture: true }],
      ['keypress', () => activate(), { capture: true }],
      ['keyup',    () => activate(), { capture: true }],
      ['click',    () => activate(), { capture: true }],
      ['pointerdown', () => activate(), { capture: true }],
    ];

    handlers.forEach(([ev, fn, opt]) => window.addEventListener(ev, fn, opt));
    return () => handlers.forEach(([ev, fn, opt]) => window.removeEventListener(ev, fn, opt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioOk]);

  const handleAtivarSom = async () => {
    if (audioOk) return;
    try {
      // 1) tenta destravar com áudio curtinho quase mudo
      const test = new Audio('/busina.mp3');
      test.volume = 0.01;
      await test.play().catch(() => {});
      test.pause();
      test.currentTime = 0;

      // 2) tenta acordar WebAudio
      if (window.AudioContext || window.webkitAudioContext) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {});
        }
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.0001;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.02);
      }

      setAudioOk(true);
    } catch (e) {
      console.warn('Falha ao liberar áudio; tente apertar OK novamente.', e);
    }
  };

  const carroDestaque = carroFinalizado || fila[carroAtual];

  return (
    <div className="painel">
      {/* OVERLAY ATIVAR SOM */}
      {!audioOk && (
        <div
          onClick={handleAtivarSom}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAtivarSom(); }}
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
            textAlign: 'center',
            cursor: 'pointer'
          }}
        >
          <div
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
              Pressione <strong>OK</strong> no controle remoto (ou qualquer tecla).
              Isso é necessário apenas na primeira abertura.
            </div>
            <div
              style={{
                fontSize: '1.8rem',
                fontWeight: 900,
                background: 'cyan',
                color: '#000',
                borderRadius: 12,
                padding: '14px 22px',
                display: 'inline-block'
              }}
            >
              Ativar agora (OK)
            </div>
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
