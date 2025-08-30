// src/pages/Painel.jsx
import './Painel.css';
import axios from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// ===== Ajuste conforme ambiente =====
const API_BASE = 'https://recepcaopneuforte.onrender.com';
// const API_BASE = 'http://localhost:3001';

const VIDEO_AUDIO_ENABLED = true;

// Socket (reconexão ligada)
const socket = io(API_BASE, { transports: ['websocket', 'polling'], reconnection: true });

export default function Painel() {
  // guarda ?token=... no localStorage (facilita no Render)
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    if (t) localStorage.setItem('token', t);
  }, []);

  // -------- Fila / destaque --------
  const [fila, setFila] = useState([]);
  const [carroAtual, setCarroAtual] = useState(0);
  const [carroFinalizado, setCarroFinalizado] = useState(null);
  const [emDestaque, setEmDestaque] = useState(false);

  const intervaloRef = useRef(null);
  const timeoutDestaqueRef = useRef(null);

  // -------- Playlist / overlay --------
  const [playlist, setPlaylist] = useState([]);
  const [overlayOn, setOverlayOn] = useState(false);
  const [overlayIdx, setOverlayIdx] = useState(0);
  const [windowSec/* , setWindowSec */] = useState(240);

  const videoRef = useRef(null);
  const imgTimerRef = useRef(null);

  // impedir reabrir dentro do mesmo bloco
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
    } catch (err) {
      console.error('Erro ao buscar fila:', err);
    }
  };

  // ------- fetch JSON -------
  const fetchJson = async (path, opts = {}) => {
    const r = await fetch(`${API_BASE}${path}`, {
      cache: 'no-store',
      headers: { ...(opts.headers || {}), ...getAuthHeaders() },
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  };

  // ------- Normalização -------
  const normalize = (arr) =>
    (arr || []).map((m) => ({
      id: m.id,
      url: m.url,
      src: m.src,
      tipo: String(m.tipo || '').toUpperCase(), // IMG | VIDEO/VID
      titulo: m.titulo || '',
      data_inicio: m.data_inicio || null,       // "YYYY-MM-DD HH:mm:ss" (LOCAL)
      data_fim: m.data_fim || null,             // idem
      intervalo_minutos: m.intervalo_minutos ?? m.intervalo_minuto ?? 0,
      image_duration_ms:
        m.image_duration_ms ?? m.duracao_ms ??
        (m.duracao_seg ? Number(m.duracao_seg) * 1000 : undefined),
      ord: Number(m.ord ?? 0),
      ativo: m.ativo == null ? 1 : Number(m.ativo),
    }));

  // ------- Buscar playlist -------
  const fetchPlaylist = async () => {
    try {
      // 1) pública
      let items = [];
      try {
        const j = await fetchJson('/api/playlist');
        items = Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items : [];
      } catch (e) {
        // se falhou, tenta fallback SOMENTE se tiver token
        if (getToken()) {
          const j2 = await fetchJson('/api/midia');
          items = Array.isArray(j2) ? j2 : [];
        } else {
          // sem token: não tenta /api/midia para não gerar 403
          items = [];
        }
      }

      setPlaylist(normalize(items));
    } catch (e) {
      console.warn('Falha ao buscar playlist:', e?.message || e);
      setPlaylist([]);
    }
  };

  // ------- Cargas iniciais -------
  useEffect(() => { buscarFila(); fetchPlaylist(); }, []);

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
      intervaloRef.current = setInterval(
        () => setCarroAtual((p) => (p + 1) % fila.length),
        6000
      );
    } else {
      setCarroAtual(0);
    }
    return () => clearInterval(intervaloRef.current);
  }, [fila, carroFinalizado]);

  // ================== Agendamento / Overlay ==================
  const parseMaybe = (s) => {
    if (!s) return null;
    const str = String(s).trim();
    let m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      const [, y, M, d, h, mi, sec = '00'] = m;
      const t = new Date(+y, +M - 1, +d, +h, +mi, +sec).getTime();
      return Number.isFinite(t) ? t : null;
    }
    m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?.*(Z|[+\-]\d{2}:?\d{2})$/);
    if (m) {
      const [, y, M, d, h, mi, sec = '00'] = m;
      const t = new Date(+y, +M - 1, +d, +h, +mi, +sec).getTime();
      return Number.isFinite(t) ? t : null;
    }
    const t = Date.parse(str);
    return Number.isFinite(t) ? t : null;
  };

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
  const mustOpenOverlayNow = (t) => visibleNow(t).some((it) => inIntervalWindow(it, t, windowSec));

  useEffect(() => {
    const tick = () => {
      const t = nowMS();
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
  };

  const stopOverlay = (closeAndSuppress = true) => {
    setOverlayOn(false);
    if (imgTimerRef.current) { clearTimeout(imgTimerRef.current); imgTimerRef.current = null; }
    try {
      const v = videoRef.current;
      if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    } catch {}
    if (closeAndSuppress) {
      suppressUntilRef.current = Math.max(
        suppressUntilRef.current,
        overlayBlockEndRef.current || 0
      );
    }
  };

  const isVideoKind = (x) => String(x?.tipo || '').toUpperCase().startsWith('VID');
  const mediaBase = (it) => it.src || `${API_BASE}${it.url}`;
  const withCacheBuster = (base) => base + (base.includes('?') ? '&' : '?') + '_=' + Date.now();

  // ================== Áudio (TTS) ==================
  const audioRef = useRef(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const pendingTTSRef = useRef(null);

  useEffect(() => {
    const a = new Audio();
    a.preload = 'auto';
    a.crossOrigin = 'anonymous';
    a.playsInline = true;
    audioRef.current = a;

    const unlock = () => {
      if (!audioUnlocked) {
        try {
          a.muted = false;
          a.volume = 1;
          a.play().catch(()=>{}); a.pause(); a.currentTime = 0;
        } catch {}
        setAudioUnlocked(true);
        if (pendingTTSRef.current) {
          const txt = pendingTTSRef.current;
          pendingTTSRef.current = null;
          speak(txt);
        }
      }
    };

    // TV/teclado: Enter/Space/OK; mouse/touch
    const onKey = (ev) => {
      const k = (ev.code || ev.key || '').toLowerCase();
      if (['enter','space','numpadenter','mediaplaypause','ok'].some(x => k.includes(x))) unlock();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', onKey);
    };
  }, [audioUnlocked]);

  const speak = async (text) => {
    try {
      const a = audioRef.current;
      if (!a) return;

      if (!audioUnlocked) { pendingTTSRef.current = text; return; }

      const url = `${API_BASE}/api/tts?text=${encodeURIComponent(text)}`;

      a.pause();
      a.src = url;
      a.currentTime = 0;
      await a.play().catch(() => {
        if ('speechSynthesis' in window) {
          const u = new SpeechSynthesisUtterance(text);
          u.lang = 'pt-BR';
          window.speechSynthesis.speak(u);
        }
      });
    } catch {
      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'pt-BR';
        window.speechSynthesis.speak(u);
      }
    }
  };

  const makeTTSMessage = (carro) => {
    const modelo = carro?.modelo ? carro.modelo : '';
    const placa = carro?.placa ? carro.placa : '';
    const servicos = [carro?.servico, carro?.servico2, carro?.servico3].filter(Boolean).join(', ');
    let txt = `Serviço finalizado, carro ${modelo}, placa ${placa}.`;
    if (servicos) txt += ` Serviços: ${servicos}.`;
    txt += ` Cliente, favor dirigir-se à recepção.`;
    return txt;
  };

  // ====== Vídeo: autoplay seguro ======
  const startVideoWithSafeAutoplay = (videoEl, url) => {
    if (!videoEl) return;

    videoEl.setAttribute('muted', '');
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.setAttribute('playsinline', '');
    videoEl.setAttribute('webkit-playsinline', '');
    videoEl.autoplay = true;
    videoEl.preload = 'auto';
    videoEl.disableRemotePlayback = true;
    videoEl.crossOrigin = 'anonymous';

    const src = withCacheBuster(url);

    videoEl.onended = null;
    videoEl.onerror = null;
    videoEl.onloadeddata = null;
    videoEl.onloadedmetadata = null;
    videoEl.oncanplay = null;
    videoEl.onplaying = null;
    videoEl.onstalled = null;

    try { videoEl.pause(); } catch {}
    try { videoEl.removeAttribute('src'); } catch {}
    try { videoEl.load(); } catch {}

    videoEl.src = src;
    try { videoEl.load(); } catch {}

    let failTimer = null;
    let retriedOnce = false;

    const tryUnmuteIfAllowed = () => {
      if (VIDEO_AUDIO_ENABLED && audioUnlocked) {
        [0, 120, 600, 2000].forEach((ms) => {
          setTimeout(() => { try { videoEl.muted = false; videoEl.volume = 1; } catch {} }, ms);
        });
      }
    };

    const confirmFirstFrameOrRetry = () => {
      if ('requestVideoFrameCallback' in videoEl) {
        try {
          videoEl.requestVideoFrameCallback((_now, meta) => {
            if (!meta || meta.presentedFrames === 0) retryWithNewSrc();
          });
        } catch {}
      }
    };

    const retryWithNewSrc = () => {
      if (retriedOnce) return;
      retriedOnce = true;
      try { videoEl.pause(); } catch {}
      try { videoEl.removeAttribute('src'); } catch {}
      try { videoEl.load(); } catch {}

      const src2 = withCacheBuster(url);
      videoEl.src = src2;
      try { videoEl.load(); } catch {}
      try { if (videoEl.currentTime === 0) videoEl.currentTime = 0.001; } catch {}
      safePlay(false);
    };

    const stopFail = () => { if (failTimer) { clearTimeout(failTimer); failTimer = null; } };

    const safePlay = async (tryUnmutedFirst = true) => {
      try {
        videoEl.muted = tryUnmutedFirst ? !VIDEO_AUDIO_ENABLED : true;
        try { if (videoEl.currentTime === 0) videoEl.currentTime = 0.001; } catch {}
        await videoEl.play();
        tryUnmuteIfAllowed();
      } catch {
        if (tryUnmutedFirst) {
          try {
            videoEl.muted = true;
            await videoEl.play();
            tryUnmuteIfAllowed();
          } catch { stopOverlay(true); }
        } else { stopOverlay(true); }
      }
    };

    videoEl.onloadedmetadata = () => {
      try { if (videoEl.currentTime === 0) videoEl.currentTime = 0.001; } catch {}
    };
    videoEl.onloadeddata = () => { safePlay(true); };
    videoEl.oncanplay   = () => { if (videoEl.paused) safePlay(true); };
    videoEl.onplaying   = () => { stopFail(); confirmFirstFrameOrRetry(); tryUnmuteIfAllowed(); };
    videoEl.onstalled   = () => { retryWithNewSrc(); };
    videoEl.onended     = () => stopOverlay(true);
    videoEl.onerror     = () => stopOverlay(true);

    failTimer = setTimeout(() => {
      if (videoEl.paused || videoEl.readyState < 2) stopOverlay(true);
    }, 8000);
  };

  // toca item atual quando o overlay abre
  useEffect(() => {
    if (!overlayOn) return;
    const items = visibleNow(nowMS());
    if (!items.length) return;

    const current = items[overlayIdx % items.length];
    if (imgTimerRef.current) { clearTimeout(imgTimerRef.current); imgTimerRef.current = null; }

    const base = mediaBase(current);

    if (isVideoKind(current)) {
      startVideoWithSafeAutoplay(videoRef.current, base);
    } else {
      const durMs =
        Number(current.image_duration_ms) ||
        Number(current.duracao_ms) ||
        (Number(current.duracao_seg || 10) * 1000);
      const ms = Math.max(3000, durMs || 10000);
      imgTimerRef.current = setTimeout(() => stopOverlay(true), ms);
    }

    return () => {
      if (imgTimerRef.current) { clearTimeout(imgTimerRef.current); imgTimerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayOn, overlayIdx]);

  // ================== Sockets ==================
  useEffect(() => {
    const onCarroFinalizado = (carro) => {
      stopOverlay(true);
      setCarroFinalizado(carro);
      setEmDestaque(true);

      // fala (TTS)
      speak(makeTTSMessage(carro));

      setFila((prev) => {
        const nova = prev.filter((c) => c.id !== carro.id);
        setCarroAtual((idx) => (idx >= nova.length ? 0 : idx));
        return nova;
      });

      if (timeoutDestaqueRef.current) clearTimeout(timeoutDestaqueRef.current);
      timeoutDestaqueRef.current = setTimeout(() => {
        setCarroFinalizado(null);
        setEmDestaque(false);
      }, 30000);
    };

    const onNovoCarroAdicionado = () => { buscarFila(); stopOverlay(true); };

    socket.on('carroFinalizado', onCarroFinalizado);
    socket.on('novoCarroAdicionado', onNovoCarroAdicionado);
    return () => {
      socket.off('carroFinalizado', onCarroFinalizado);
      socket.off('novoCarroAdicionado', onNovoCarroAdicionado);
      if (timeoutDestaqueRef.current) clearTimeout(timeoutDestaqueRef.current);
    };
  }, []);

  useEffect(() => {
    if (!carroFinalizado && emDestaque) setEmDestaque(false);
  }, [carroFinalizado, emDestaque]);

  const carroDestaque = carroFinalizado || fila[carroAtual];
  const overlayItems  = useMemo(() => visibleNow(nowMS()), [playlist]);

  const currentOverlayItem =
    overlayOn && overlayItems.length > 0 ? overlayItems[overlayIdx % overlayItems.length] : null;

  const currentImgSrc =
    currentOverlayItem && !isVideoKind(currentOverlayItem)
      ? withCacheBuster(mediaBase(currentOverlayItem))
      : null;

  return (
    <div className="painel">
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
      {overlayOn && currentOverlayItem && (
        <div className="media-overlay">
          {isVideoKind(currentOverlayItem) ? (
            <video ref={videoRef} className="media-el" muted playsInline autoPlay />
          ) : (
            <img className="media-el" alt={currentOverlayItem.titulo || 'mídia'} src={currentImgSrc || ''} />
          )}
        </div>
      )}

      {/* botão central para destravar som */}
      {!audioUnlocked && (
        <button
          onClick={() => {
            // dispara o desbloqueio via evento de clique
            const ev = new Event('pointerdown');
            window.dispatchEvent(ev);
          }}
          style={{
            position:'fixed', inset:0, display:'flex', alignItems:'center', justifyContent:'center',
            background:'rgba(0,0,0,.6)', border:'none', color:'#fff', fontSize:24,
            cursor:'pointer'
          }}
        >
          🔊 Ativar som (OK/Enter)
        </button>
      )}
    </div>
  );
}
