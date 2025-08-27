// src/pages/Painel.jsx
import './Painel.css';
import axios from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// ===== Ajuste conforme ambiente =====
const API_BASE = 'https://recepcaopneuforte.onrender.com';
// const API_BASE = 'http://localhost:3001';

// Forçar som do vídeo quando permitido pelo navegador/dispositivo:
const VIDEO_AUDIO_ENABLED = true;

// Socket
const socket = io(API_BASE, { transports: ['websocket', 'polling'], reconnection: true });

export default function Painel() {
  // grava ?token=... no localStorage (facilita no Render)
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    if (t) localStorage.setItem('token', t);
  }, []);

  // -------- Fila / destaque --------
  const [fila, setFila] = useState([]);
  const [carroAtual, setCarroAtual] = useState(0);
  const [carroFinalizado, setCarroFinalizado] = useState(null);
  const [emDestaque, setEmDestaque] = useState(false);

  // Liberação de áudio: deixamos true (não exige clique); se o device bloquear, tocamos mudo.
  const [audioOK] = useState(true);

  const intervaloRef = useRef(null);
  const timeoutDestaqueRef = useRef(null);

  // -------- Playlist / overlay --------
  const [playlist, setPlaylist] = useState([]);
  const [overlayOn, setOverlayOn] = useState(false);
  const [overlayIdx, setOverlayIdx] = useState(0);
  const [windowSec/*, setWindowSec*/] = useState(240);
  const videoRef = useRef(null);
  const imgTimerRef = useRef(null);

  // suprimir reabertura no mesmo bloco
  const suppressUntilRef = useRef(0);
  const overlayBlockEndRef = useRef(0);

  const TOKEN = (localStorage.getItem('token') || '').trim();
  const authHeaders = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};

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

  // ------- Helpers de fetch JSON com token -------
  const fetchJson = async (path) => {
    const r = await fetch(`${API_BASE}${path}`, { cache: 'no-store', headers: authHeaders });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  };

  // ------- Normalização de mídia/playlist -------
  const normalize = (arr) => {
    return (arr || []).map((m) => {
      const tipoRaw = String(m.tipo || '').toUpperCase();
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
  };

  // ------- Buscar playlist (com fallback para /api/midia) -------
  const fetchPlaylist = async () => {
    try {
      let items = [];
      try {
        const j = await fetchJson('/api/playlist'); // pode exigir token
        items = Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items : [];
      } catch (e) {
        console.warn('playlist falhou:', e?.message || e);
      }

      if (!Array.isArray(items) || items.length === 0) {
        const j2 = await fetchJson('/api/midia');   // fallback autenticado
        items = Array.isArray(j2) ? j2 : [];
      }

      setPlaylist(normalize(items));
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

  const mustOpenOverlayNow = (t) =>
    visibleNow(t).some((it) => inIntervalWindow(it, t, windowSec));

  // tick imediato + a cada 500ms
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
    // roda já na montagem/alteração (evita “ficar esperando”)
    tick();
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
      suppressUntilRef.current = Math.max(suppressUntilRef.current, overlayBlockEndRef.current || 0);
    }
  };

  const isVideoKind = (x) => String(x?.tipo || '').toUpperCase().startsWith('VID');

  // --------- resolver URL (corrige prefixo quando já é http/https) ---------
  const resolveSrc = (it) => {
    const raw = it?.src || it?.url || '';
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;           // já é absoluta
    const path = raw.startsWith('/') ? raw : `/${raw}`;  // garante barra
    return `${API_BASE}${path}`;
  };
  const withCacheBuster = (base) =>
    base + (base.includes('?') ? '&' : '?') + '_=' + Date.now();

  // ============ PLAY de VÍDEO: anti-tela-preta + unmuted-first + retries ============
  const startVideoWithSafeAutoplay = (videoEl, url, wantsSound) => {
    if (!videoEl || !url) return;

    // atributos seguros ANTES do src
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

    // limpa handlers anteriores e estado
    videoEl.onended = null;
    videoEl.onerror = null;
    videoEl.onloadeddata = null;
    videoEl.onloadedmetadata = null;
    videoEl.oncanplay = null;
    videoEl.onplaying = null;
    videoEl.onstalled = null;
    videoEl.onwaiting = null;

    try { videoEl.pause(); } catch {}
    try { videoEl.removeAttribute('src'); } catch {}
    try { videoEl.load(); } catch {}

    videoEl.src = src;
    try { videoEl.load(); } catch {}

    let failTimer = null;
    let retriedOnce = false;

    const wantAudio = VIDEO_AUDIO_ENABLED && wantsSound;
    const tryUnmuteIfAllowed = () => {
      if (!wantAudio) return;
      // se o device permitir, já sai com som
      [0, 150, 600, 2000].forEach((ms) => {
        setTimeout(() => { try { videoEl.muted = false; videoEl.volume = 1; } catch {} }, ms);
      });
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

    // tenta unmuted primeiro; se o navegador bloquear, cai pra mudo automaticamente
    const safePlay = async (tryUnmutedFirst = true) => {
      try {
        videoEl.muted = tryUnmutedFirst ? !wantAudio : true;
        try { if (videoEl.currentTime === 0) videoEl.currentTime = 0.001; } catch {}
        await videoEl.play();
        tryUnmuteIfAllowed();
      } catch {
        if (tryUnmutedFirst) {
          try {
            videoEl.muted = true;
            await videoEl.play();
            tryUnmuteIfAllowed();
          } catch {
            stopOverlay(true);
          }
        } else {
          stopOverlay(true);
        }
      }
    };

    videoEl.onloadedmetadata = () => {
      try { if (videoEl.currentTime === 0) videoEl.currentTime = 0.001; } catch {}
    };
    videoEl.onloadeddata = () => safePlay(true);
    videoEl.oncanplay = () => { if (videoEl.paused) safePlay(true); };
    videoEl.onplaying = () => { stopFail(); tryUnmuteIfAllowed(); };
    videoEl.onwaiting = () => { /* rede lenta → deixa tocar mudo; retry se travar demais */ };
    videoEl.onstalled = () => retryWithNewSrc();
    videoEl.onended = () => stopOverlay(true);
    videoEl.onerror = () => stopOverlay(true);

    // fail-safe: se em 8s não ficou "playing", fecha overlay (evita ficar preso)
    failTimer = setTimeout(() => {
      if (videoEl.paused || videoEl.readyState < 2) stopOverlay(true);
    }, 8000);
  };
  // ========================================================================

  // toca item atual
  useEffect(() => {
    if (!overlayOn) return;
    const items = visibleNow(nowMS());
    if (!items.length) return;

    const current = items[overlayIdx % items.length];

    if (imgTimerRef.current) { clearTimeout(imgTimerRef.current); imgTimerRef.current = null; }

    const base = resolveSrc(current);

    if (isVideoKind(current)) {
      startVideoWithSafeAutoplay(videoRef.current, base, current.audio_on !== false);
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

  // ================== Sockets (finalização + novo carro) ==================
  useEffect(() => {
    const onCarroFinalizado = async (carro) => {
      stopOverlay(true);
      setCarroFinalizado(carro);
      setEmDestaque(true);

      setFila((prev) => {
        const nova = prev.filter((c) => c.id !== carro.id);
        setCarroAtual((idx) => (idx >= nova.length ? 0 : idx));
        return nova;
      });
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
  }, []);

  useEffect(() => {
    if (!carroFinalizado && emDestaque) setEmDestaque(false);
  }, [carroFinalizado, emDestaque]);

  const carroDestaque = carroFinalizado || fila[carroAtual];
  const overlayItems = useMemo(() => visibleNow(nowMS()), [playlist]);

  // item atual do overlay + src cache-busted
  const currentOverlayItem =
    overlayOn && overlayItems.length > 0
      ? overlayItems[overlayIdx % overlayItems.length]
      : null;

  const currentImgSrc = currentOverlayItem && !isVideoKind(currentOverlayItem)
    ? withCacheBuster(resolveSrc(currentOverlayItem))
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
        <div className="media-overlay" onClick={() => stopOverlay(true)}>
          {isVideoKind(currentOverlayItem) ? (
            <video
              key={currentOverlayItem.id}
              ref={videoRef}
              className="media-el"
              muted
              playsInline
              autoPlay
            />
          ) : (
            <img
              className="media-el"
              alt={currentOverlayItem.titulo || 'mídia'}
              src={currentImgSrc || ''}
            />
          )}
        </div>
      )}
    </div>
  );
}
