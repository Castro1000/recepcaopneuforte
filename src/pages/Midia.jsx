// src/pages/Midia.jsx
import React, { useEffect, useRef, useState } from "react";
import "./Midia.css";

const DEFAULT_DURATION_MS = 8000;       // 8s
const DEFAULT_SEQ_STEP_MS = 10000;      // 10s

const PRESETS = [
  { key: "local",  label: "Localhost (3001)",             url: "http://localhost:3001" },
  { key: "render", label: "Hospedagem (Render)",          url: "https://recepcaopneuforte.onrender.com" },
  { key: "same",   label: "Mesmo host do front (vazio)",  url: "" }, // usa o mesmo domínio do front
];
const CUSTOM_KEY = "__custom__";

function pickInitialApiBase() {
  try {
    const u = new URL(window.location.href);
    const qs = u.searchParams.get("api");
    if (qs) {
      if (qs === "local")  return "http://localhost:3001";
      if (qs === "render") return "https://recepcaopneuforte.onrender.com";
      if (qs === "same" || qs === "/") return "";
      if (/^https?:\/\//i.test(qs)) return qs;
    }
  } catch {}
  const saved = localStorage.getItem("apiBase");
  if (saved !== null) return saved;
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    return "http://localhost:3001";
  return "https://recepcaopneuforte.onrender.com";
}

// utils
const toInt = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : d;
};
const humanToMs = (value, unit) => {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_DURATION_MS;
  return unit === "min" ? v * 60000 : v * 1000;
};
const msToHuman = (ms) => {
  if (!Number.isFinite(ms)) return "";
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return rs ? `${m}m ${rs}s` : `${m}m`;
};

export default function Midia() {
  // ----- seletor de backend -----
  const [apiBase, setApiBase] = useState(pickInitialApiBase());
  const [customUrl, setCustomUrl] = useState(() => localStorage.getItem("apiBaseCustom") || "");
  const selectValue = PRESETS.some(p => p.url === apiBase) ? apiBase : CUSTOM_KEY;
  useEffect(() => { localStorage.setItem("apiBase", apiBase); }, [apiBase]);

  // token (só envia se existir para evitar preflight desnecessário)
  const token = (localStorage.getItem("token") || "").trim();

  // helpers de request
  const makeUrl = (pathOrFull) => {
    if (!pathOrFull) return "";
    if (/^(https?:)?\/\//i.test(pathOrFull) || pathOrFull.startsWith("blob:") || pathOrFull.startsWith("data:")) {
      return pathOrFull;
    }
    return `${apiBase}${pathOrFull}`;
  };

  async function apiAuth(path, opt = {}) {
    const headers = opt.headers ? { ...opt.headers } : {};
    // NUNCA setar Content-Type quando body é FormData
    if (!(opt.body instanceof FormData)) headers["Content-Type"] = "application/json";
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const r = await fetch(makeUrl(path), { ...opt, headers, cache: "no-store" });
      if (!r.ok) {
        let detail = "";
        try { detail = await r.text(); } catch {}
        throw new Error(`${detail || "erro"} (HTTP ${r.status})`);
      }
      try { return await r.json(); } catch { return {}; }
    } catch (e) {
      throw new Error(e.message || "Failed to fetch");
    }
  }

  // ----- estado -----
  const [midias, setMidias] = useState([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // ref do input de arquivo (para reset real)
  const fileInputRef = useRef(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const [form, setForm] = useState({
    titulo: "",
    files: [],
    data_inicio: "",
    data_fim: "",
    intervalo_minutos: 15,
    durationValue: 8,
    durationUnit: "s",
    seq_step_sec: 10,
  });

  // carregar lista
  const carregarMidias = async () => {
    setErr(""); setMsg("");
    try {
      const data = await apiAuth("/api/midia", { method: "GET" });
      setMidias(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setErr("Não foi possível carregar a lista de mídias (verifique login/backend).");
      setMidias([]);
    }
  };
  useEffect(() => { carregarMidias(); /* eslint-disable-line */ }, []);
  useEffect(() => { carregarMidias(); }, [apiBase]);

  // seleção de arquivos
  const onFiles = (e) => {
    const list = Array.from(e.target.files || []);
    if (!list.length) return setForm(f => ({ ...f, files: [] }));
    const firstVideo = list.find(f => f.type.startsWith("video/"));
    if (firstVideo) return setForm(f => ({ ...f, files: [firstVideo] })); // só 1 vídeo
    const imgs = list.filter(f => f.type.startsWith("image/"));
    setForm(f => ({ ...f, files: imgs }));
  };

  const limparInputArquivo = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
    setFileInputKey(k => k + 1); // força recriar o input (reset)
  };

  // salvar
  const salvar = async () => {
    if (isSaving) return;
    setErr(""); setMsg("");

    if (!form.files.length) {
      setErr("Selecione um vídeo ou imagens.");
      return;
    }
    if (form.data_inicio && form.data_fim && new Date(form.data_inicio) > new Date(form.data_fim)) {
      setErr("O início não pode ser depois do término.");
      return;
    }

    const isVideo = form.files[0].type.startsWith("video/");
    const image_duration_ms = humanToMs(form.durationValue, form.durationUnit);
    const seq_enabled = !isVideo && form.files.length > 1;
    const seq_step_ms = toInt(form.seq_step_sec * 1000, DEFAULT_SEQ_STEP_MS);
    const intervaloMin = toInt(form.intervalo_minutos, 15);

    try {
      setIsSaving(true);
      let okCount = 0;

      for (const file of form.files) {
        const fd = new FormData();
        fd.append("titulo", form.titulo || "");
        fd.append("arquivo", file);
        fd.append("data_inicio", form.data_inicio || "");
        fd.append("data_fim", form.data_fim || "");
        fd.append("intervalo_minutos", String(intervaloMin));
        fd.append("image_duration_ms", String(image_duration_ms));
        // dicas p/ backend (pode ignorar)
        fd.append("seq_enabled", String(seq_enabled ? 1 : 0));
        fd.append("seq_count", String(seq_enabled ? form.files.length : 1));
        fd.append("seq_step_ms", String(seq_enabled ? seq_step_ms : 0));

        // cache-bust no endpoint (evita cache/CDN)
        const endpoint = `/api/midia?ts=${Date.now()}&uid=${Math.random().toString(36).slice(2)}`;

        // IMPORTANTE: sem headers customizados (evita CORS no Render)
        await apiAuth(endpoint, { method: "POST", body: fd });
        okCount++;
      }

      setMsg(isVideo
        ? "Vídeo enviado com sucesso."
        : okCount > 1
          ? `Imagens enviadas: ${okCount}.`
          : "Imagem enviada com sucesso."
      );

      // resetar form
      setForm({
        titulo: "",
        files: [],
        data_inicio: "",
        data_fim: "",
        intervalo_minutos: 15,
        durationValue: 8,
        durationUnit: "s",
        seq_step_sec: 10,
      });
      limparInputArquivo();
      await carregarMidias();
    } catch (e) {
      console.error(e);
      setErr(`Falha ao salvar: ${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // excluir
  const excluir = async (id) => {
    setErr(""); setMsg("");
    try {
      await apiAuth(`/api/midia/${id}`, { method: "DELETE" });
      setMsg("Mídia removida.");
      carregarMidias();
    } catch (e) {
      console.error(e);
      setErr("Erro ao excluir.");
    }
  };

  const resolveUrl = (u) => makeUrl(u);

  const isMultiImage = form.files.length > 1 && form.files.every(f => f.type.startsWith("image/"));
  const isVideoSel = form.files.length === 1 && form.files[0]?.type.startsWith("video/");
  const tempoMs = humanToMs(form.durationValue, form.durationUnit);

  return (
    <div className="midia-container">
      <h2>Gerenciar Mídias</h2>

      {/* seletor de backend */}
      <div className="backend-picker">
        <label>Backend</label>
        <div className="backend-line">
          <select
            value={selectValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === CUSTOM_KEY) {
                setApiBase(customUrl || "");
              } else {
                setApiBase(v);
              }
            }}
          >
            {PRESETS.map(p => (
              <option key={p.key} value={p.url}>{p.label}</option>
            ))}
            <option value={CUSTOM_KEY}>Personalizado…</option>
          </select>

          {selectValue === CUSTOM_KEY && (
            <input
              type="text"
              placeholder="https://seu-backend.com"
              value={customUrl}
              onChange={(e) => {
                const v = e.target.value.trim();
                setCustomUrl(v);
                localStorage.setItem("apiBaseCustom", v);
                setApiBase(v);
              }}
            />
          )}
        </div>
        <div className="muted using">Usando: {apiBase || "(mesmo host do front)"}.</div>
      </div>

      {/* formulário */}
      <div className="midia-form">
        <div className="row">
          <input
            type="text"
            placeholder="Título"
            value={form.titulo}
            onChange={(e) => setForm({ ...form, titulo: e.target.value })}
          />

          <div className="field">
            <label>Arquivo (vídeo ou imagens — pode selecionar várias imagens)</label>
            <input
              key={fileInputKey}
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={onFiles}
            />
            {form.files.length > 0 && (
              <div className="muted tiny">
                {isVideoSel ? `1 vídeo selecionado` : `${form.files.length} imagem(ns) selecionada(s)`}
              </div>
            )}
          </div>

          <div className="grid-2">
            <div className="field">
              <label>Início</label>
              <input
                type="datetime-local"
                value={form.data_inicio}
                onChange={(e) => setForm({ ...form, data_inicio: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Término</label>
              <input
                type="datetime-local"
                value={form.data_fim}
                onChange={(e) => setForm({ ...form, data_fim: e.target.value })}
              />
            </div>
          </div>

          <div className="field">
            <label>Mostrar novamente a cada (min)</label>
            <input
              type="number"
              min="1"
              value={form.intervalo_minutos}
              onChange={(e) => setForm({ ...form, intervalo_minutos: toInt(e.target.value, 15) })}
            />
          </div>

          <div className="grid-2">
            <div className="field">
              <label>Tempo na tela</label>
              <div className="inline">
                <input
                  type="number"
                  min="1"
                  value={form.durationValue}
                  onChange={(e) => setForm({ ...form, durationValue: toInt(e.target.value, 8) })}
                />
                <select
                  value={form.durationUnit}
                  onChange={(e) => setForm({ ...form, durationUnit: e.target.value })}
                >
                  <option value="s">segundos</option>
                  <option value="min">minutos</option>
                </select>
              </div>
              <div className="muted tiny">= {msToHuman(tempoMs)}</div>
            </div>

            <div className="field">
              <label>Transição entre imagens (padrão 10s)</label>
              <input
                type="number"
                min="0"
                value={form.seq_step_sec}
                onChange={(e) => setForm({ ...form, seq_step_sec: toInt(e.target.value, 10) })}
                disabled={!isMultiImage}
              />
              {!isMultiImage && <div className="muted tiny">Ativo ao selecionar 2+ imagens</div>}
            </div>
          </div>

          <button className="btn primary" onClick={salvar} disabled={isSaving}>
            {isSaving ? "Enviando..." : "Salvar"}
          </button>

          {!!msg && <div className="ok">{msg}</div>}
          {!!err && <div className="error">{err}</div>}
        </div>
      </div>

      {/* lista */}
      <h3>Mídias Cadastradas</h3>
      <ul className="midia-lista">
        {midias.map((m) => (
          <li key={m.id}>
            <div className="item-grid">
              <div>
                <strong>{m.titulo || "(sem título)"}</strong>
                <div className="muted meta">
                  {(m.tipo === "IMG" ? "Imagem" : "Vídeo")} · fica {msToHuman(Number(m.image_duration_ms) || DEFAULT_DURATION_MS)} na tela
                  {m.intervalo_minutos != null ? ` · Intervalo: ${m.intervalo_minutos} min` : ""}
                </div>
                {(m.data_inicio || m.data_fim) && (
                  <div className="muted meta">
                    {m.data_inicio ? `Início: ${new Date(m.data_inicio).toLocaleString()}` : ""}
                    {m.data_inicio && m.data_fim ? " · " : ""}
                    {m.data_fim ? `Término: ${new Date(m.data_fim).toLocaleString()}` : ""}
                  </div>
                )}
                <div className="preview">
                  {m.tipo === "IMG"
                    ? <img src={resolveUrl(m.url)} alt={m.titulo || "img"} />
                    : <video src={resolveUrl(m.url)} muted controls />
                  }
                </div>
              </div>
              <div className="right-actions">
                <button className="btn danger" onClick={() => excluir(m.id)}>Excluir</button>
              </div>
            </div>
          </li>
        ))}
        {!midias.length && <li className="muted empty">Sem itens</li>}
      </ul>
    </div>
  );
}
