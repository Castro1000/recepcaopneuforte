// src/pages/Painel.jsx
import './Painel.css';
import axios from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// ===== Ajuste conforme ambiente =====
const API_BASE = 'https://recepcaopneuforte.onrender.com';
// const API_BASE = 'http://localhost:3001';

const socket = io(API_BASE, { transports: ['websocket', 'polling'], reconnection: true });

// Flags
const URLQS = new URLSearchParams(window.location.search);
const DEBUG = URLQS.has('debug');
const FORCE_SHOW = URLQS.has('show');   // força o overlay abrir se houver item ativo
const dlog = (...a) => { if (DEBUG) console.log('[Painel]', ...a); };

export default function Painel() {
  // grava ?token=... no localStorage (útil no Render)
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    if (t) localStorage.setItem('token', t);
  }, []);

  // -------- Fila / destaque --------
  const [fila, setFila] = useState([]);
  const [carroAtual, setCarroAtual] = useState(0);
  const [carroFinalizado, setCarroFinalizado] = useState(null);
  const [emDestaque, setEmDestaque] = useState(false);

  // Liberação de áudio
  const [audioOK, setAudioOK] = useState(false);
  const unlockBtnRef = useRef(null);

  const intervaloRef = useRef(null);
  const timeoutDestaqueRef = useRef(null);

  // -------- Playlist / overlay --------
  const [playlist, setPlaylist] = useState([]);
  const [overlayOn, setOverlayOn] = useState(false);
  const [overlayIdx, setOverlayIdx] = useState(0);
  const [windowSec/*, setWindowSec*/] = useState(240);
  const videoRef = useRef(null);
  const imgTimerRef = useRef(null);

  // janelas
  const suppressUntilRef = useRef(0);
  const overlayBlockEndRef = useRef(0);

  const getToken = () => (localStorage.getItem('token') || '').trim();
  const getAuthHeaders = () => {
    const tk = getToken();
    return tk ? { Authorization: `Bearer ${tk}` } : {};
  };

  const montaServicos = (c) =>
    [c?.servico, c?.servico2, c?.servico3].filter(Boolean).join(' | ');
  const nowMS = () => Date.now();

  // ------- Buscar fila -------
  const buscarFila = async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/api/fila-servico`, { withCredentials: false });
      if (Array.isArray(data)) setFila(data.slice(0, 7));
      else console.error('A resposta da API /fila-servico não é um array:', data);
    } catch (err) {
      console.error('Erro ao buscar fila:', err);
    }
  };

  // ------- Helpers de fetch JSON (Authorization + ?token= fallback) -------
  const fetchFirstOk = async (paths) => {
    for (const path of paths) {
      try {
        const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
        const r = await fetch(url, { cache: 'no-store', headers: getAuthHeaders() });
        if (!r.ok) throw new Error(String(r.status));
        return await r.json();
      } catch (e) {
        dlog('fetch falhou:', path, e?.message || e);
      }
    }
    return null;
  };

  // ------- Normalização de mídia/playlist -------
  const normalize = (arr) =>
    (arr || []).map((m) => {
      const tipoRaw = String(m.tipo || '').toUpperCase().trim();
      return {
        id: m.id,
        url: m.url,
        src: m.src,
        tipo: tipoRaw,                       // "IMG" | "VIDEO"/"VID"
        titulo: m.titulo || '',
        data_inicio: m.data_inicio || null,
        data_fim: m.data_fim || null,
        intervalo_minutos: m.intervalo_minutos ?? 0,
        image_duration_ms:
          m.image_duration_ms ??
          m.duracao_ms ??
          (m.duracao_seg ? Number(m.duracao_seg) * 1000 : undefined),
        ord: Number(m.ord ?? 0),
        ativo: m.ativo == null ? 1 : Number(m.ativo),
        audio_on: m.audio_on ?? true,
      };
    });

  // ------- Buscar playlist -------
  const fetchPlaylist = async () => {
    try {
      const tk = getToken();
      const itemsJson =
        (await fetchFirstOk([
          '/api/playlist',
          `/api/playlist?token=${encodeURIComponent(tk)}`,
          '/api/midia',
          `/api/midia?token=${encodeURIComponent(tk)}`
        ])) || [];

      const items = Array.isArray(itemsJson)
        ? itemsJson
        : Array.isArray(itemsJson?.items) ? itemsJson.items : [];

      const norm = normalize(items);
      setPlaylist(norm);
      dlog('Playlist:', norm);
    } catch (e) {
      console.warn('Falha ao buscar playlist:', e);
      setPlaylist([]);
    }
  };

  // ------- Cargas iniciais -------
  useEffect(() => {
    buscarFila();
    fetchPlaylist();
  }, []);

  // ------- Atualizações periódicas -------
  useEffect(() => {
    const t1 = setInterval(buscarFila, 30000);
    const t2 = setInterval(fetchPlaylist, 20000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, []);

  // ------- carrossel lateral -------
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

  // ================== Liberação de áudio (click/OK) ==================
  const unlockAudio = async () => {
    try {
      // desbloqueio de áudio
      const a = new Audio('/motor.mp3');
      a.volume = 0;
      await a.play().catch(() => {});
      a.pause(); a.currentTime = 0;
      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(' ');
        u.lang = 'pt-BR';
        window.speechSynthesis.speak(u);
      }
      setAudioOK(true);

      // desmuta vídeo se já estiver tocando
      const v = videoRef.current;
      if (v && !v.paused) {
        try { v.muted = false; v.volume = 1; await v.play(); } catch {}
      }
    } catch { setAudioOK(true); }
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
      if (!audioOK && ok) { e.preventDefault(); unlockAudio(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [audioOK]);

  // ================== Agendamento / Overlay ==================
  const parseMaybe = (s) => (s ? new Date(s).getTime() : null);
  const inDateWindow = (item, t) => {
    const ini = parseMaybe(item.data_inicio);
    const fim = parseMaybe(item.data_fim);
    if (ini && t < ini) return false;
    if (fim && t > fim) return false;
    return true;
  };
  const isActive = (x) => (x?.ativo == null ? 1 : Number(x.ativo)) === 1;

  const visibleNow = (t) =>
    (playlist || [])
      .filter(isActive)
      .filter((x) => inDateWindow(x, t))
      .sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0) || String(a.id).localeCompare(String(b.id)));

  const ivMs = (it) => Math.max(0, Number(it.intervalo_minutos || 0) * 60000);
  const anchorMs = (it) => {
    const ini = parseMaybe(it.data_inicio);
    return Number.isFinite(ini) ? ini : 0;
  };
  const blockStart = (it, t) => {
    const iv = ivMs(it);
    if (iv <= 0) return t;
    const base = anchorMs(it);
    return Math.floor((t - base) / iv) * iv + base;
  };
  const inIntervalWindow = (it, t, wndSec) => {
    const iv = ivMs(it);
    if (iv <= 0) return true;
    const bs = blockStart(it, t);
    return t >= bs && (t - bs) < wndSec * 1000;
  };

  const mustOpenOverlayNow = (t) => {
    const vis = visibleNow(t);
    if (FORCE_SHOW) return vis.length > 0;
    return vis.some((it) => inIntervalWindow(it, t, windowSec));
  };

  // tick imediato + 500ms
  useEffect(() => {
    const tick = () => {
      const t = nowMS();
      const vis = visibleNow(t);
      dlog('tick', { visiveis: vis.length, overlayOn, t, FORCE_SHOW });
      if (t < suppressUntilRef.current) return;

      if (carroFinalizado) {
        if (overlayOn) stopOverlay(false);
        return;
      }
      if (mustOpenOverlayNow(t)) {
        if (!overlayOn) startOverlay(t);
      } else {
        if (overlayOn) stopOverlay(false);
      }
    };
    tick(); // roda já
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist, carroFinalizado, windowSec, overlayOn]);

  const startOverlay = (tStart) => {
    const items = visibleNow(tStart);
    if (!items.length) return;

    setOverlayIdx(0);
    setOverlayOn(true);

    const ref = items[0];
    const iv = ivMs(ref);
    if (iv > 0) {
      const bs = blockStart(ref, tStart);
      overlayBlockEndRef.current = bs + iv;
    } else {
      overlayBlockEndRef.current = tStart + windowSec * 1000;
    }
    dlog('overlay START', { ate: overlayBlockEndRef.current, ref });
  };

  const stopOverlay = (closeAndSuppress = true) => {
    setOverlayOn(false);
    if (imgTimerRef.current) { clearTimeout(imgTimerRef.current); imgTimerRef.current = null; }
    try {
      const v = videoRef.current;
      if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    } catch {}
    if (closeAndSuppress) {
      suppressUntilRef.current = Math.max(suppressUntilRef.current, overlayBlockEndRef.current || 0);
    }
    dlog('overlay STOP');
  };

  const isVideoKind = (x) => {
    const t = String(x?.tipo || '').toUpperCase();
    if (t.startsWith('VID')) return true;
    const raw = x?.src || x?.url || '';
    return /\.(mp4|webm|ogv|m3u8)(\?|#|$)/i.test(raw);
  };

  // --------- URL helpers ---------
  const resolveBase = (it) => {
    const raw = it?.src || it?.url || '';
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    return `${API_BASE}${path}`;
  };
  const withCacheBuster = (base) => base + (base.includes('?') ? '&' : '?') + '_=' + Date.now();

  // ============ Player de vídeo (estável) ============
  const startVideo = (videoEl, url, wantsSound) => {
    if (!videoEl || !url) return;

    // atributos ANTES do src (autoplay seguro)
    videoEl.setAttribute('muted', '');
    videoEl.setAttribute('playsinline', '');
    videoEl.setAttribute('webkit-playsinline', '');
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.autoplay = true;
    videoEl.preload = 'auto';

    // zera e aplica src
    try { videoEl.pause(); } catch {}
    try { videoEl.removeAttribute('src'); videoEl.load(); } catch {}

    const src = withCacheBuster(url);
    videoEl.src = src;

    let failTimer = setTimeout(() => {
      dlog('FAILSAFE 8s — não ficou playing, fechando overlay');
      stopOverlay(true);
    }, 8000);

    const tryUnmute = () => {
      if (!wantsSound) return;
      if (!audioOK) return;
      [0, 150, 600, 2000].forEach((ms) =>
        setTimeout(() => { try { videoEl.muted = false; videoEl.volume = 1; } catch {} }, ms)
      );
    };

    videoEl.onloadeddata = async () => {
      try { if (videoEl.currentTime === 0) videoEl.currentTime = 0.001; } catch {}
      try {
        await videoEl.play();
        dlog('play() OK');
        tryUnmute();
      } catch (e) {
        dlog('play() falhou, tenta mudo', e);
        try {
          videoEl.muted = true;
          await videoEl.play();
          tryUnmute();
        } catch (e2) {
          clearTimeout(failTimer);
          stopOverlay(true);
        }
      }
    };
    videoEl.onplaying = () => { clearTimeout(failTimer); dlog('onplaying'); tryUnmute(); };
    videoEl.onended = () => { dlog('onended'); stopOverlay(true); };
    videoEl.onerror = () => { dlog('onerror'); stopOverlay(true); };

    try { videoEl.load(); } catch {}
  };
  // ===============================================

  // tocar item atual (vídeo/ imagem)
  useEffect(() => {
    if (!overlayOn) return;
    const items = visibleNow(nowMS());
    if (!items.length) return;

    const current = items[overlayIdx % items.length];
    dlog('Tocar item', current);

    if (imgTimerRef.current) { clearTimeout(imgTimerRef.current); imgTimerRef.current = null; }

    const base = resolveBase(current);
    if (!base) { stopOverlay(true); return; }

    if (isVideoKind(current)) {
      startVideo(videoRef.current, base, current.audio_on !== false);
    } else {
      const durMs =
        Number(current.image_duration_ms) ||
        Number(current.duracao_ms) ||
        (Number(current.duracao_seg || 10) * 1000);
      const ms = Math.max(3000, durMs || 10000);
      dlog('Imagem por', ms, 'ms');
      imgTimerRef.current = setTimeout(() => stopOverlay(true), ms);
    }

    return () => {
      if (imgTimerRef.current) { clearTimeout(imgTimerRef.current); imgTimerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayOn, overlayIdx, audioOK]);

  // ================== Sockets (finalização + novo carro) ==================
  useEffect(() => {
    const onCarroFinalizado = async (carro) => {
      stopOverlay(true); // interrompe overlay e suprime reabertura

      setCarroFinalizado(carro);
      setEmDestaque(true);

      setFila((prev) => {
        const nova = prev.filter((c) => c.id !== carro.id);
        setCarroAtual((idx) => (idx >= nova.length ? 0 : idx));
        return nova;
      });

      // --- FLUXO DE ÁUDIO / TTS (mantido) ---
      const tocarFluxo = async () => {
        try {
          await playWithFallback('/busina.mp3', { timeoutMs: 2000 }).catch(() => {});
          const motor = new Audio('/motor.mp3'); motor.preload = 'auto'; motor.volume = 1;

          let halfTimer = null;
          const halfPromise = new Promise((res) => {
            motor.addEventListener('loadedmetadata', () => {
              const half = ((motor.duration || 2) / 2) * 1000;
              halfTimer = setTimeout(() => { new Audio('/freiada.mp3').play().catch(() => {}); res(null); }, half);
            });
            setTimeout(() => { if (!halfTimer) { new Audio('/freiada.mp3').play().catch(() => {}); res(null); } }, 1200);
          });
          const endPromise = new Promise((res) => {
            motor.addEventListener('ended', () => res(null));
            motor.addEventListener('error', () => res(null));
            setTimeout(() => res(null), 4000);
          });

          motor.play().catch(() => {});
          await Promise.race([endPromise]);
          clearTimeout(halfTimer);
          await halfPromise;

          await playWithFallback('/busina.mp3', { timeoutMs: 2500 }).catch(() => {});

          const ajustarLetra = (L) => ({ Q: 'quê', W: 'dáblio', Y: 'ípsilon', E: 'é' }[L?.toUpperCase()] || L?.toUpperCase());
          const placaSeparada = (carro.placa || '').toString().toUpperCase().split('').map(ajustarLetra).join(' ');
          const modeloCorrigido = corrigirPronunciaModelo(carro.modelo);
          const frase = `Serviço finalizado, Carro ${modeloCorrigido}, placa ${placaSeparada}, cor ${carro.cor}, dirija-se ao caixa. Obrigado pela preferência!`;

          const url = new URL(`${API_BASE}/api/tts`);
          url.searchParams.set('text', frase);
          const tk = getToken(); if (tk) url.searchParams.set('token', tk);

          const reason = await playUrl(url.toString(), { volume: 1, timeoutMs: 15000 });
          if (reason !== 'ended') {
            const ok = speak(frase);
            if (!ok) await playWithFallback('/busina.mp3', { timeoutMs: 1500 }).catch(() => {});
          }
        } catch (e) {
          console.warn('Erro no fluxo de áudio:', e);
        }
      };

      if (audioOK) {
        tocarFluxo();
      } else {
        const watch = setInterval(() => { if (audioOK) { clearInterval(watch); tocarFluxo(); } }, 250);
        setTimeout(() => clearInterval(watch), 20000);
      }

      if (timeoutDestaqueRef.current) clearTimeout(timeoutDestaqueRef.current);
      timeoutDestaqueRef.current = setTimeout(() => {
        setCarroFinalizado(null);
        setEmDestaque(false);
      }, 30000);
    };

    const onNovoCarroAdicionado = () => {
      buscarFila();
      stopOverlay(true);
    };

    socket.on('carroFinalizado', onCarroFinalizado);
    socket.on('novoCarroAdicionado', onNovoCarroAdicionado);

    return () => {
      socket.off('carroFinalizado', onCarroFinalizado);
      socket.off('novoCarroAdicionado', onNovoCarroAdicionado);
      if (timeoutDestaqueRef.current) clearTimeout(timeoutDestaqueRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioOK]);

  useEffect(() => {
    if (!carroFinalizado && emDestaque) setEmDestaque(false);
  }, [carroFinalizado, emDestaque]);

  const carroDestaque = carroFinalizado || fila[carroAtual];
  const overlayItems = useMemo(() => visibleNow(nowMS()), [playlist]);

  return (
    <div className="painel">
      {/* OVERLAY DE PERMISSÃO */}
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

      {/* TOPO */}
      <div className="topo">
        <div className="titulo" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/img/logo_pneuforte.png" alt="Pneu Forte" style={{ height: 65, objectFit: 'contain' }} />
        </div>
        <div className="previsao" style={{ fontSize: '3rem', fontWeight: 800, letterSpacing: '15px', textTransform: 'uppercase', textShadow: '0 0 10px cyan' }}>
          LISTA DE ESPERA
        </div>
      </div>

      {/* CONTEÚDO PRINCIPAL */}
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

      {/* RODAPÉ PARCEIROS */}
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

      {/* OVERLAY DE MÍDIA */}
      {overlayOn && overlayItems.length > 0 && (
        <div className="media-overlay" onClick={() => stopOverlay(true)}>
          {isVideoKind(overlayItems[overlayIdx % overlayItems.length]) ? (
            <video ref={videoRef} className="media-el" muted playsInline autoPlay />
          ) : (
            <img
              className="media-el"
              alt={overlayItems[overlayIdx % overlayItems.length].titulo || 'mídia'}
              src={(function () {
                const it = overlayItems[overlayIdx % overlayItems.length];
                const base = resolveBase(it);
                return withCacheBuster(base);
              })()}
            />
          )}
        </div>
      )}
    </div>
  );
}
