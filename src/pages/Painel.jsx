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

  // Liberação de áudio para TVs (OK no controle)
  const [audioOK, setAudioOK] = useState(false);
  const unlockBtnRef = useRef(null);

  const intervaloRef = useRef(null);
  const timeoutDestaqueRef = useRef(null);

  // -------- helpers --------
  const corrigirPronunciaModelo = (modelo) => {
    const m = (modelo || '').toString().trim();
    const upper = m.toUpperCase();
    switch (upper) {
      case 'KWID': return 'cuidi';
      case 'BYD': return 'biu ai dii';
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

  // === Liberação de áudio (OK no controle) ===
  const unlockAudio = async () => {
    try {
      const a = new Audio('/motor.mp3');
      a.volume = 0;
      await a.play().catch(() => {});
      a.pause();
      a.currentTime = 0;

      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(' ');
        u.lang = 'pt-BR';
        window.speechSynthesis.speak(u);
      }
      setAudioOK(true);
    } catch (e) {
      console.warn('Falha ao liberar áudio:', e);
      setAudioOK(true);
    }
  };

  useEffect(() => {
    if (!audioOK) {
      const t0 = Date.now();
      const tick = () => {
        if (audioOK) return;
        unlockBtnRef.current?.focus();
        if (Date.now() - t0 < 1000) requestAnimationFrame(tick);
      };
      tick();
    }
  }, [audioOK]);

  useEffect(() => {
    const onKey = (e) => {
      const ok = e.key === 'Enter' || e.key === 'NumpadEnter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 32;
      if (!audioOK && ok) {
        e.preventDefault();
        unlockAudio();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [audioOK]);

  // === Fala via Web Speech (fallback) ===
  const speak = (texto) => {
    if (!('speechSynthesis' in window)) return false;
    try {
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = 'pt-BR';
      u.rate = 1.0;
      const voices = window.speechSynthesis.getVoices?.() || [];
      const v = voices.find(v => v.lang?.toLowerCase().startsWith('pt')) || voices[0];
      if (v) u.voice = v;
      window.speechSynthesis.cancel(); // evita fila acumulada
      window.speechSynthesis.speak(u);
      return true;
    } catch {
      return false;
    }
  };

  // === Player robusto para URL (inclui /api/tts) ===
  const playUrl = (url, { volume = 1, timeoutMs = 15000 } = {}) =>
    new Promise((resolve) => {
      const a = new Audio();
      a.preload = 'auto';
      a.crossOrigin = 'anonymous';
      a.volume = volume;
      // cache-bust para evitar cache agressivo em TVs
      const sep = url.includes('?') ? '&' : '?';
      a.src = `${url}${sep}_=${Date.now()}`;
      let done = false;
      const finish = (reason = 'ok') => {
        if (done) return;
        done = true;
        try { a.pause(); } catch {}
        resolve(reason);
      };
      a.addEventListener('canplay', () => {
        // canplay costuma ser mais confiável que loadedmetadata em TVs
        a.play().catch(() => finish('blocked'));
      });
      a.addEventListener('ended', () => finish('ended'));
      a.addEventListener('error', () => finish('error'));
      a.load(); // inicia o carregamento
      setTimeout(() => finish('timeout'), timeoutMs);
    });

  // === Player simples para arquivos locais (buzina, etc.) ===
  const playWithFallback = (url, { volume = 1, timeoutMs = 7000 } = {}) =>
    new Promise((resolve) => {
      const a = new Audio(url);
      a.preload = 'auto';
      a.volume = volume;
      let done = false;
      const finish = (reason = 'ok') => {
        if (done) return;
        done = true;
        try { a.pause(); } catch {}
        resolve(reason);
      };
      a.addEventListener('ended', () => finish('ended'));
      a.addEventListener('error', () => finish('error'));
      a.play().catch(() => finish('blocked'));
      setTimeout(() => finish('timeout'), timeoutMs);
    });

  // 3) sockets: finalização + novo carro (REGISTRA UMA VEZ)
  useEffect(() => {
    const onCarroFinalizado = async (carro) => {
      setCarroFinalizado(carro);
      setEmDestaque(true);

      const tocarFluxo = async () => {
        try {
          // 1) toquezinho inicial
          await playWithFallback('/busina.mp3', { timeoutMs: 2000 }).catch(() => {});

          // 2) MOTOR + freiada no meio (com fallback)
          const motor = new Audio('/motor.mp3');
          motor.preload = 'auto';
          motor.volume = 1;

          let halfTimer = null;
          const halfPromise = new Promise((resolveHalf) => {
            motor.addEventListener('loadedmetadata', () => {
              const half = ((motor.duration || 2) / 2) * 1000;
              halfTimer = setTimeout(() => {
                new Audio('/freiada.mp3').play().catch(() => {});
                resolveHalf(null);
              }, half);
            });
            // fallback caso metadata não venha
            setTimeout(() => {
              if (!halfTimer) {
                new Audio('/freiada.mp3').play().catch(() => {});
                resolveHalf(null);
              }
            }, 1200);
          });

          const endPromise = new Promise((resolveEnd) => {
            motor.addEventListener('ended', () => resolveEnd(null));
            motor.addEventListener('error', () => resolveEnd(null));
            setTimeout(() => resolveEnd(null), 4000);
          });

          motor.play().catch(() => {});
          await Promise.race([endPromise]);
          clearTimeout(halfTimer);
          await halfPromise;

          // 3) buzina final
          await playWithFallback('/busina.mp3', { timeoutMs: 2500 }).catch(() => {});

          // 4) FALA via backend TTS
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
          const frase = `Serviço finalizado, Carro ${modeloCorrigido}, placa ${placaSeparada}, cor ${carro.cor}, Por favor, dirija-se ao caixa.`;

          // tenta tocar o MP3 gerado pelo backend
          const reason = await playUrl(`${API_BASE}/api/tts?text=${encodeURIComponent(frase)}`, {
            volume: 1,
            timeoutMs: 15000
          });

          if (reason !== 'ended') {
            // fallback 1: Web Speech (se existir)
            const ok = speak(frase);
            if (!ok) {
              // fallback 2: toque de atenção
              await playWithFallback('/busina.mp3', { timeoutMs: 2000 }).catch(() => {});
            }
          }
        } catch (e) {
          console.warn('Erro no fluxo de áudio:', e);
        }
      };

      if (audioOK) tocarFluxo();
      else {
        // espera liberar e roda o fluxo uma única vez
        const watch = setInterval(() => {
          if (audioOK) {
            clearInterval(watch);
            tocarFluxo();
          }
        }, 250);
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
    };
  }, [audioOK]); // observa audioOK

  // 4) Guard extra
  useEffect(() => {
    if (!carroFinalizado && emDestaque) setEmDestaque(false);
  }, [carroFinalizado, emDestaque]);

  const carroDestaque = carroFinalizado || fila[carroAtual];

  return (
    <div className="painel">
      {/* OVERLAY DE PERMISSÃO PARA TV SAMSUNG */}
      {!audioOK && (
        <button
          ref={unlockBtnRef}
          autoFocus
          onClick={unlockAudio}
          onKeyDown={(e) => {
            const ok = e.key === 'Enter' || e.key === 'NumpadEnter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 32;
            if (ok) { e.preventDefault(); unlockAudio(); }
          }}
          style={{
            position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.85)',
            color: '#0ff', fontSize: '3rem', fontWeight: 800, textShadow: '0 0 10px #0ff',
            border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 8, padding: 20, cursor: 'pointer'
          }}
        >
          <div>Pressione <u>OK</u> no controle</div>
          <div style={{ fontSize: '1.4rem', color: '#9ff' }}>
            para habilitar o áudio e a voz das chamadas
          </div>
        </button>
      )}

      <div className="topo">
        <div className="titulo" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/img/logo_pneuforte.png" alt="Pneu Forte" style={{ height: 65, objectFit: 'contain' }} />
        </div>
        <div className="previsao" style={{ fontSize: '3rem', fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase', textShadow: '0 0 10px cyan' }}>
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
