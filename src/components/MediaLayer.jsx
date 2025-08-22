import React, { useEffect, useMemo, useRef, useState } from "react";
import "./MediaLayer.css";

// Decide o backend automaticamente, mas respeita o que você já usa no Midia.jsx
function pickApiBase() {
  const saved = localStorage.getItem("apiBase"); // mesmo seletor que você usa no Midia.jsx
  if (saved) return saved;
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    return "http://localhost:3001";
  }
  return "https://recepcaopneuforte.onrender.com";
}

export default function MediaLayer() {
  const API_BASE = useMemo(() => pickApiBase(), []);
  const [items, setItems] = useState([]);     // playlist atual
  const [cur, setCur] = useState(null);       // item em exibição
  const [tick, setTick] = useState(0);        // força re-render do <video> quando troca
  const timersRef = useRef({});               // timeouts
  const lastPlayedRef = useRef({});           // mapa id->timestamp ms

  // carrega lastPlayed da sessão para respeitar intervalo entre recarregamentos
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("__lastPlayed") || "{}";
      lastPlayedRef.current = JSON.parse(raw);
    } catch {}
  }, []);

  // salva lastPlayed ao sair
  useEffect(() => {
    const save = () =>
      sessionStorage.setItem("__lastPlayed", JSON.stringify(lastPlayedRef.current));
    window.addEventListener("beforeunload", save);
    return () => {
      save();
      window.removeEventListener("beforeunload", save);
    };
  }, []);

  // util limpeza de timeouts
  function clearTimers() {
    Object.values(timersRef.current).forEach(clearTimeout);
    timersRef.current = {};
  }

  // busca da playlist (pública)
  async function loadPlaylist() {
    try {
      const r = await fetch(`${API_BASE}/api/playlist`, { cache: "no-store" });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      console.error("[MediaLayer] Falha ao buscar playlist:", e);
      setItems([]);
    }
  }

  // ciclo de atualização da playlist
  useEffect(() => {
    let stop = false;
    (async () => {
      await loadPlaylist();
      // revalida a cada 30s (ajuste se quiser)
      while (!stop) {
        await new Promise(res => (timersRef.current.poll = setTimeout(res, 30000)));
        await loadPlaylist();
      }
    })();
    return () => {
      stop = true;
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_BASE]);

  // escolhe próximo item respeitando intervalo_minutos
  function pickNext(now = Date.now()) {
    if (!items.length) return null;
    // ordenação já vem por ord,id no backend; percorre na ordem
    for (const it of items) {
      const last = Number(lastPlayedRef.current[it.id] || 0);
      const gapMs = (Number(it.intervalo_minutos) || 0) * 60000;
      if (!gapMs || now - last >= gapMs) {
        return it;
      }
    }
    return null;
  }

  // inicia próximo
  function playNext() {
    clearTimers();
    const next = pickNext();
    if (!next) {
      // nada elegível agora -> tenta de novo quando vencer o menor intervalo restante (ou 15s)
      const now = Date.now();
      let wait = 15000;
      for (const it of items) {
        const last = Number(lastPlayedRef.current[it.id] || 0);
        const gapMs = (Number(it.intervalo_minutos) || 0) * 60000;
        if (gapMs) {
          const left = Math.max(0, gapMs - (now - last));
          if (left > 0) wait = Math.min(wait, left);
        }
      }
      timersRef.current.idle = setTimeout(playNext, wait);
      setCur(null);
      return;
    }

    // marca como reproduzido
    lastPlayedRef.current[next.id] = Date.now();
    sessionStorage.setItem("__lastPlayed", JSON.stringify(lastPlayedRef.current));

    setCur(next);
    setTick(t => t + 1);

    // se for imagem, programa avanço pela duração
    if (next.tipo === "IMG") {
      const secs = Math.max(3, Number(next.duracao_seg) || 10);
      timersRef.current.img = setTimeout(playNext, secs * 1000);
    }
    // se for vídeo, deixamos o onEnded disparar; mas por segurança, um teto de 10 min
    if (next.tipo === "VIDEO") {
      timersRef.current.guard = setTimeout(playNext, 10 * 60 * 1000);
    }
  }

  // quando a playlist muda, decide tocar algo
  useEffect(() => {
    if (!items.length) {
      // sem itens -> esconde
      setCur(null);
      clearTimers();
      return;
    }
    // se não há nada tocando, inicia
    if (!cur) playNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // callbacks
  const handleEnded = () => playNext();
  const handleError = () => playNext();

  if (!cur) return null;

  return (
    <div className="media-layer show">
      {cur.tipo === "VIDEO" ? (
        <video
          key={`${cur.id}-${tick}`}
          className="media-el"
          src={cur.src}
          autoPlay
          muted
          playsInline
          onEnded={handleEnded}
          onError={handleError}
        />
      ) : (
        <img
          key={`${cur.id}-${tick}`}
          className="media-el"
          src={cur.src}
          alt={cur.titulo || "midia"}
          onError={handleError}
        />
      )}
    </div>
  );
}
