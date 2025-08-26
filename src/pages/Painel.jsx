import './Painel.css';
import axios from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

// ===== Ajuste conforme ambiente =====
const API_BASE = 'https://recepcaopneuforte.onrender.com';
// const API_BASE = 'http://localhost:3001';

const socket = io(API_BASE);

export default function Painel() {
  // captura ?token=... (para gravar no domínio do Render facilmente)
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
        tipo: tipoRaw,                       // "IMG" | "VIDEO"
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
      };
    });
  };

  // ------- Buscar playlist (com fallback para /api/midia) -------
  const fetchPlaylist = async () => {
    try {
      let items = [];
      try {
        const j = await fetchJson('/api/playlist'); // se precisar, usa token
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

  // ================== Liberação de áudio ==================
  const unlockAudio = async () => {
    try {
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
      .sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0) || a.id - b.id);

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
      suppressUntilRef.current = Math.max(suppressUntilRef.current, overlayBlockEndRef.current || 0);
    }
  };

  const isVideoKind = (x) => String(x?.tipo || '').toUpperCase().startsWith('VID');

  useEffect(() => {
    if (!overlayOn) return;
    const items = visibleNow(nowMS());
    if (!items.length) return;

    const current = items[overlayIdx % items.length];

    if (imgTimerRef.current) { clearTimeout(imgTimerRef.current); imgTimerRef.current = null; }

    const src = current.src || `${API_BASE}${current.url}`;
    const mediaSrc = src + (src.includes('?') ? '&' : '?') + '_=' + Date.now();

    if (isVideoKind(current)) {
      const v = videoRef.current;
      if (!v) return;
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      v.preload = 'auto';
      v.crossOrigin = 'anonymous';
      v.src = mediaSrc;

      v.onended = () => stopOverlay(true);
      v.onerror = () => stopOverlay(true);
      v.onloadeddata = () => { v.play().catch(() => stopOverlay(true)); };

      const failTimer = setTimeout(() => stopOverlay(true), 8000);
      v.onplaying = () => clearTimeout(failTimer);
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

      // (fluxo de áudio mantido igual ao seu)
      // ...
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

      {/* (restante idêntico ao seu) */}
      {/* ... UI da fila, cards e overlay ... */}
      {overlayOn && overlayItems.length > 0 && (
        <div className="media-overlay" onClick={() => stopOverlay(true)}>
          {isVideoKind(overlayItems[overlayIdx % overlayItems.length]) ? (
            <video ref={videoRef} className="media-el" />
          ) : (
            <img
              className="media-el"
              alt={overlayItems[overlayIdx % overlayItems.length].titulo || 'mídia'}
              src={
                (overlayItems[overlayIdx % overlayItems.length].src ||
                 `${API_BASE}${overlayItems[overlayIdx % overlayItems.length].url}`) +
                ((overlayItems[overlayIdx % overlayItems.length].src || `${API_BASE}${overlayItems[overlayIdx % overlayItems.length].url}`).includes('?') ? '&' : '?') +
                '_=' + Date.now()
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
