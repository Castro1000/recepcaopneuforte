import './Painel.css';
import axios from 'axios';
import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

// const API_BASE = 'http://localhost:3001';
const API_BASE = 'https://recepcaopneuforte.onrender.com';
const socket = io(API_BASE, { transports: ['websocket', 'polling'] });

// duração do destaque
const DUR_DESTAQUE_MS = 30000;

export default function Painel() {
  const [fila, setFila] = useState([]);
  const [carroAtual, setCarroAtual] = useState(0);
  const [carroFinalizado, setCarroFinalizado] = useState(null);
  const [emDestaque, setEmDestaque] = useState(false);

  // ÁUDIO
  const [audioOk, setAudioOk] = useState(false);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const audioElemsRef = useRef({});

  // timers
  const intervaloRef = useRef(null);
  const timeoutDestaqueRef = useRef(null);
  const destaqueDesdeRef = useRef(0);

  const corrigirPronunciaModelo = (modelo) => {
    const m = (modelo || '').toString().trim();
    const u = m.toUpperCase();
    switch (u) {
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
  const montaServicos = (c) => [c?.servico, c?.servico2, c?.servico3].filter(Boolean).join(' | ');

  const buscarFila = async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/api/fila-servico`);
      if (Array.isArray(data)) setFila(data.slice(0, 7));
    } catch (err) {
      console.error('Erro ao buscar fila:', err);
    }
  };

  // ---------- ÁUDIO: desbloqueio para TV ----------
  const prewarmAudio = async () => {
    // cria e tenta um "play mudo" + pause para elevar o engajamento
    const busina1 = new Audio('/busina.mp3');
    const motor   = new Audio('/motor.mp3');
    const freiada = new Audio('/freiada.mp3');
    const busina2 = new Audio('/busina.mp3');
    audioElemsRef.current = { busina1, motor, freiada, busina2 };

    try {
      for (const a of [busina1, motor, freiada, busina2]) {
        a.muted = true; a.volume = 0;
        await a.play().catch(() => {});
        a.pause(); a.currentTime = 0; a.muted = false; a.volume = 1;
      }
      // pode “parecer” liberado na Samsung; por isso ainda pedimos OK uma vez
    } catch {}
  };

  const tryPlay = async (audio) => {
    try { await audio.play(); return true; } catch { return false; }
  };

  const unlockByKey = async () => {
    // qualquer tecla do controle (OK/setas) chama isso
    const a = audioElemsRef.current.busina1 || new Audio('/busina.mp3');
    const ok = await tryPlay(a);
    if (ok) {
      setAudioOk(true);
      setNeedsUnlock(false);
      localStorage.setItem('pf_audio_unlocked', '1');
    }
  };

  // ---------- montagem inicial ----------
  useEffect(() => {
    buscarFila();
    prewarmAudio();

    // se nunca desbloqueou nesta TV, pedimos OK
    const firstTime = !localStorage.getItem('pf_audio_unlocked');
    setNeedsUnlock(firstTime);
    setAudioOk(!firstTime);

    // captura tecla do controle como gesto
    const onKey = () => unlockByKey();
    window.addEventListener('keydown', onKey, { passive: true });

    // às vezes ajuda quando a aba volta a ficar visível
    const onVis = () => { if (document.visibilityState === 'visible' && !audioOk) prewarmAudio(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- carrossel ----------
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

  // ---------- watchdog: garante que o destaque desliga ----------
  useEffect(() => {
    const id = setInterval(() => {
      if (emDestaque && destaqueDesdeRef.current) {
        const passou = Date.now() - destaqueDesdeRef.current;
        if (passou > DUR_DESTAQUE_MS + 5000) {
          setCarroFinalizado(null);
          setEmDestaque(false);
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [emDestaque]);

  // ---------- sockets ----------
  useEffect(() => {
    const anunciarCarro = (carro) => {
      try {
        if (!('speechSynthesis' in window)) return;
        const ajustarLetra = (letra) => {
          const mapa = { Q: 'quê', W: 'dáblio', Y: 'ípsilon', E: 'é' };
          return mapa[letra.toUpperCase()] || letra.toUpperCase();
        };
        const placaSeparada = (carro.placa || '')
          .toString().toUpperCase().split('').map(ajustarLetra).join(' ');
        const modeloCorrigido = corrigirPronunciaModelo(carro.modelo);
        const frase = `Carro ${modeloCorrigido}, placa ${placaSeparada}, cor ${carro.cor}, dirija-se ao caixa.`;

        const falar = (texto) => {
          const u = new SpeechSynthesisUtterance(texto);
          u.lang = 'pt-BR'; u.volume = 1; u.rate = 1.0;
          window.speechSynthesis.speak(u);
        };
        falar(frase);
        setTimeout(() => falar(frase), 2500);
      } catch (e) {
        console.warn('Erro no TTS:', e);
      }
    };

    const onCarroFinalizado = async (carro) => {
      setCarroFinalizado(carro);
      setEmDestaque(true);
      destaqueDesdeRef.current = Date.now();

      // sequência de sons; se não tocar, overlay já terá pedido OK
      const { busina1, motor, freiada, busina2 } = audioElemsRef.current;
      try {
        if (audioOk) {
          await tryPlay(motor || new Audio('/motor.mp3'));
          await tryPlay(busina1 || new Audio('/busina.mp3'));
          if (motor) {
            motor.onloadedmetadata = () => {
              const meio = (motor.duration / 2) * 1000;
              setTimeout(() => { tryPlay(freiada || new Audio('/freiada.mp3')); }, meio);
            };
            motor.onended = async () => {
              await tryPlay(busina2 || new Audio('/busina.mp3'));
              anunciarCarro(carro);
            };
          } else {
            setTimeout(() => anunciarCarro(carro), 800);
          }
        } else {
          // áudio bloqueado: só anuncia texto (se suportado) quando liberar
          if ('speechSynthesis' in window) anunciarCarro(carro);
        }
      } catch (e) {
        console.warn('Erro na sequência de áudio:', e);
      }

      // remove da fila e ajusta índice
      setFila((prev) => {
        const nova = prev.filter((c) => c.id !== carro.id);
        setCarroAtual((idx) => (idx >= nova.length ? 0 : idx));
        return nova;
      });

      // timeout padrão de 30s
      if (timeoutDestaqueRef.current) clearTimeout(timeoutDestaqueRef.current);
      timeoutDestaqueRef.current = setTimeout(() => {
        setCarroFinalizado(null);
        setEmDestaque(false);
      }, DUR_DESTAQUE_MS);
    };

    const onNovoCarroAdicionado = () => buscarFila();

    socket.on('carroFinalizado', onCarroFinalizado);
    socket.on('novoCarroAdicionado', onNovoCarroAdicionado);

    return () => {
      socket.off('carroFinalizado', onCarroFinalizado);
      socket.off('novoCarroAdicionado', onNovoCarroAdicionado);
      if (timeoutDestaqueRef.current) clearTimeout(timeoutDestaqueRef.current);
    };
  }, [audioOk]);

  // se por algum motivo carroFinalizado sumir, desliga overlay
  useEffect(() => {
    if (!carroFinalizado && emDestaque) setEmDestaque(false);
  }, [carroFinalizado, emDestaque]);

  const carroDestaque = carroFinalizado || fila[carroAtual];

  return (
    <div className="painel">
      {/* Overlay de desbloqueio para TV Samsung (apenas 1ª vez) */}
      {needsUnlock && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)',
            zIndex: 99999, display: 'flex', alignItems: 'center',
            justifyContent: 'center', textAlign: 'center', padding: 24
          }}
          onClick={unlockByKey}
        >
          <div>
            <div style={{ fontSize: '3rem', color: '#0ff', textShadow: '0 0 10px #0ff', fontWeight: 800 }}>
              Pressione <span style={{ color: '#fff' }}>OK</span> no controle
            </div>
            <div style={{ fontSize: '1.5rem', color: '#ddd', marginTop: 12 }}>
              para habilitar os sons das chamadas
            </div>
          </div>
        </div>
      )}

      <div className="topo">
        <div className="titulo" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/img/logo_pneuforte.png" alt="Pneu Forte" style={{ height: 65, objectFit: 'contain' }} />
        </div>
        <div
          className="previsao"
          style={{ fontSize: '3rem', fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase', textShadow: '0 0 10px cyan' }}
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
                {carroFinalizado && <div className="texto-finalizado">🚗 CARRO FINALIZADO ✅</div>}
                <h2>{carroDestaque.modelo?.toUpperCase()}</h2>
                <p>🔖 Placa: {carroDestaque.placa}</p>
                <p>🎨 Cor: {carroDestaque.cor}</p>
                <p>🔧 Serviços: {montaServicos(carroDestaque) || '-'}</p>
              </div>
            </div>
          ) : (
            <div className="conteudo-finalizado">
              <img src="/img/carro_pneu_forte.png" alt="Carro" className="imagem-principal" />
              <div className="info-carro"><h2>Sem carros na fila</h2></div>
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
