// src/pages/Midia.jsx
import React, { useEffect, useRef, useState } from "react";
import "./Midia.css";

// ===== Ajuste conforme ambiente =====
const API_BASE = "https://recepcaopneuforte.onrender.com";
// const API_BASE = "http://localhost:3001";

const DEFAULT_IMG_DURATION_MS = 8000;   // 8s (apenas para imagens)
const DEFAULT_SEQ_STEP_MS = 10000;      // 10s (apenas para slideshow de imagens)

// utils
const toInt = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : d;
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

// parser simples para exibir valores em <input type="datetime-local">
const parseMaybe = (s) => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};
const toDatetimeLocal = (s) => {
  const t = typeof s === "number" ? s : parseMaybe(s);
  if (!t) return "";
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const displayDate = (s) => {
  const t = parseMaybe(s);
  return t ? new Date(t).toLocaleString() : "";
};

// helpers de URL e fetch
const makeUrl = (pathOrFull) => {
  if (!pathOrFull) return "";
  if (/^(https?:)?\/\//i.test(pathOrFull) || pathOrFull.startsWith("blob:") || pathOrFull.startsWith("data:")) {
    return pathOrFull;
  }
  return `${API_BASE}${pathOrFull}`;
};

async function apiAuth(path, opt = {}) {
  const token = (localStorage.getItem("token") || "").trim();
  const headers = opt.headers ? { ...opt.headers } : {};
  if (opt.body && !(opt.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const resp = await fetch(makeUrl(path), {
    ...opt,
    headers,
    cache: "no-store",
    credentials: "omit",
  });

  if (!resp.ok) {
    let detail = "";
    try { detail = await resp.text(); } catch {}
    if (resp.status === 401) throw new Error("token_required: faça login neste domínio.");
    throw new Error(detail || `HTTP ${resp.status}`);
  }

  try { return await resp.json(); } catch { return {}; }
}

export default function Midia() {
  // grava ?token=... no localStorage (útil no Render)
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    if (t) localStorage.setItem("token", t);
  }, []);

  // estado principal
  const [midias, setMidias] = useState([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // upload form
  const fileInputRef = useRef(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [form, setForm] = useState({
    titulo: "",
    files: [],
    data_inicio: "",
    data_fim: "",
    intervalo_minutos: 15,
    seq_step_sec: 10, // transição entre imagens
  });

  // editor inline
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({
    titulo: "",
    data_inicio: "",
    data_fim: "",
    intervalo_minutos: 15,
  });
  const [isUpdating, setIsUpdating] = useState(false);

  // carregar lista
  const carregarMidias = async () => {
    setErr(""); setMsg("");
    try {
      const data = await apiAuth("/api/midia", { method: "GET" });
      setMidias(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setErr(
        e.message?.includes("token_required")
          ? "Não foi possível carregar as mídias: faça login neste domínio."
          : "Não foi possível carregar a lista de mídias."
      );
      setMidias([]);
    }
  };

  useEffect(() => { carregarMidias(); }, []);

  // seleção de arquivos
  const onFiles = (e) => {
    const list = Array.from(e.target.files || []);
    if (!list.length) return setForm((f) => ({ ...f, files: [] }));
    const firstVideo = list.find((f) => f.type.startsWith("video/"));
    if (firstVideo) return setForm((f) => ({ ...f, files: [firstVideo] })); // apenas 1 vídeo
    const imgs = list.filter((f) => f.type.startsWith("image/"));
    setForm((f) => ({ ...f, files: imgs }));
  };

  const limparInputArquivo = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
    setFileInputKey((k) => k + 1);
  };

  // salvar (upload)
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

    const hasVideo = form.files.some((f) => f.type.startsWith("video/"));
    if (!hasVideo) {
      // todas imagens selecionadas → ok
    } else if (form.files.length > 1) {
      setErr("Envie apenas 1 vídeo por vez.");
      return;
    }

    const seq_enabled = !hasVideo && form.files.length > 1;
    const seq_step_ms = toInt(form.seq_step_sec * 1000, DEFAULT_SEQ_STEP_MS);
    const intervaloMin = toInt(form.intervalo_minutos, 15);

    try {
      setIsSaving(true);
      let okCount = 0;

      for (const file of form.files) {
        const isVideo = file.type.startsWith("video/");

        const fd = new FormData();
        fd.append("titulo", form.titulo || "");
        fd.append("arquivo", file);
        fd.append("data_inicio", form.data_inicio || "");
        fd.append("data_fim", form.data_fim || "");
        fd.append("intervalo_minutos", String(intervaloMin));

        // IMPORTANTE: não permitir configurar "tempo na tela".
        // Para vídeo: deixar o player usar a duração do arquivo (mandamos 0).
        // Para imagem: usar um padrão fixo (8s).
        fd.append("image_duration_ms", String(isVideo ? 0 : DEFAULT_IMG_DURATION_MS));

        // dicas para o backend (opcional)
        fd.append("seq_enabled", String(seq_enabled ? 1 : 0));
        fd.append("seq_count", String(seq_enabled ? form.files.length : 1));
        fd.append("seq_step_ms", String(seq_enabled ? seq_step_ms : 0));

        const endpoint = `/api/midia?ts=${Date.now()}&uid=${Math.random().toString(36).slice(2)}`;
        await apiAuth(endpoint, { method: "POST", body: fd });
        okCount++;
      }

      setMsg(
        hasVideo
          ? "Vídeo enviado com sucesso."
          : okCount > 1
            ? `Imagens enviadas: ${okCount}.`
            : "Imagem enviada com sucesso."
      );

      // reset
      setForm({
        titulo: "",
        files: [],
        data_inicio: "",
        data_fim: "",
        intervalo_minutos: 15,
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
      setErr(
        e.message?.includes("token_required")
          ? "Erro ao excluir: faça login neste domínio."
          : "Erro ao excluir."
      );
    }
  };

  // editar
  const abrirEdicao = (m) => {
    setErr(""); setMsg("");
    setEditId(m.id);
    setEditForm({
      titulo: m.titulo || "",
      data_inicio: toDatetimeLocal(m.data_inicio),
      data_fim: toDatetimeLocal(m.data_fim),
      intervalo_minutos: Number(m.intervalo_minutos ?? 15),
    });
  };

  const cancelarEdicao = () => {
    setEditId(null);
    setEditForm({
      titulo: "",
      data_inicio: "",
      data_fim: "",
      intervalo_minutos: 15,
    });
  };

  const salvarEdicao = async () => {
    if (!editId || isUpdating) return;
    setErr(""); setMsg("");
    const payload = {
      titulo: editForm.titulo || "",
      data_inicio: editForm.data_inicio || "",
      data_fim: editForm.data_fim || "",
      intervalo_minutos: toInt(editForm.intervalo_minutos, 15),
      // NÃO expomos image_duration_ms aqui (sem “tempo na tela”)
    };

    if (payload.data_inicio && payload.data_fim && new Date(payload.data_inicio) > new Date(payload.data_fim)) {
      setErr("O início não pode ser depois do término.");
      return;
    }

    try {
      setIsUpdating(true);
      await apiAuth(`/api/midia/${editId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setMsg("Mídia atualizada.");
      cancelarEdicao();
      carregarMidias();
    } catch (e) {
      console.error(e);
      setErr(`Falha ao atualizar: ${e.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  // helpers
  const resolveUrl = (u) => makeUrl(u);
  const isMultiImage = form.files.length > 1 && form.files.every((f) => f.type.startsWith("image/"));
  const isVideoSel = form.files.length === 1 && form.files[0]?.type.startsWith("video/");

  return (
    <div className="midia-container">
      <h2>Gerenciar Mídias</h2>

      {/* FORM */}
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
                {isVideoSel ? `1 vídeo selecionado (duração do próprio arquivo)` : `${form.files.length} imagem(ns) selecionada(s) · duração padrão: ${msToHuman(DEFAULT_IMG_DURATION_MS)} cada`}
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
            <div className="muted tiny">Deixe em branco/0 para não repetir por intervalo.</div>
          </div>

          <div className="field">
            <label>Transição entre imagens (seg) — apenas se enviar 2+ imagens</label>
            <input
              type="number"
              min="1"
              value={form.seq_step_sec}
              onChange={(e) => setForm({ ...form, seq_step_sec: toInt(e.target.value, 10) })}
              disabled={!isMultiImage}
            />
          </div>

          {/* Sem “tempo na tela” — removido do formulário */}

          <button className="btn primary" onClick={salvar} disabled={isSaving}>
            {isSaving ? "Enviando..." : "Salvar"}
          </button>

          {!!msg && <div className="ok">{msg}</div>}
          {!!err && <div className="error">{err}</div>}
        </div>
      </div>

      {/* LISTA */}
      <h3>Mídias Cadastradas</h3>
      <ul className="midia-lista">
        {midias.map((m) => {
          const isVideo = String(m.tipo || "").toUpperCase().startsWith("VID");
          return (
            <li key={m.id}>
              <div className="item-grid">
                <div>
                  <strong>{m.titulo || "(sem título)"}</strong>
                  <div className="muted meta">
                    {isVideo ? "Vídeo (duração do arquivo)" : `Imagem · duração padrão: ${msToHuman(Number(m.image_duration_ms) || DEFAULT_IMG_DURATION_MS)}`}
                    {m.intervalo_minutos != null ? ` · Intervalo: ${m.intervalo_minutos} min` : ""}
                  </div>
                  {(m.data_inicio || m.data_fim) && (
                    <div className="muted meta">
                      {m.data_inicio ? `Início: ${displayDate(m.data_inicio)}` : ""}
                      {m.data_inicio && m.data_fim ? " · " : ""}
                      {m.data_fim ? `Término: ${displayDate(m.data_fim)}` : ""}
                    </div>
                  )}

                  <div className="preview">
                    {isVideo ? (
                      <video src={resolveUrl(m.url)} muted controls />
                    ) : (
                      <img src={resolveUrl(m.url)} alt={m.titulo || "img"} />
                    )}
                  </div>

                  {editId === m.id && (
                    <div className="edit-panel">
                      <h4>Editar {isVideo ? "vídeo" : "mídia"}</h4>
                      <div className="grid-2">
                        <div className="field">
                          <label>Título</label>
                          <input
                            type="text"
                            value={editForm.titulo}
                            onChange={(e) => setEditForm({ ...editForm, titulo: e.target.value })}
                          />
                        </div>
                        <div className="field">
                          <label>Repetir a cada (min)</label>
                          <input
                            type="number"
                            min="0"
                            value={editForm.intervalo_minutos}
                            onChange={(e) => setEditForm({ ...editForm, intervalo_minutos: toInt(e.target.value, 15) })}
                          />
                        </div>
                      </div>

                      <div className="grid-2">
                        <div className="field">
                          <label>Início</label>
                          <input
                            type="datetime-local"
                            value={editForm.data_inicio}
                            onChange={(e) => setEditForm({ ...editForm, data_inicio: e.target.value })}
                          />
                        </div>
                        <div className="field">
                          <label>Término</label>
                          <input
                            type="datetime-local"
                            value={editForm.data_fim}
                            onChange={(e) => setEditForm({ ...editForm, data_fim: e.target.value })}
                          />
                        </div>
                      </div>

                      <div className="actions">
                        <button className="btn" onClick={cancelarEdicao} disabled={isUpdating}>Cancelar</button>
                        <button className="btn primary" onClick={salvarEdicao} disabled={isUpdating}>
                          {isUpdating ? "Salvando..." : "Salvar alterações"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="right-actions">
                  {editId === m.id ? null : (
                    <button className="btn" onClick={() => abrirEdicao(m)}>
                      Editar
                    </button>
                  )}
                  <button className="btn danger" onClick={() => excluir(m.id)}>
                    Excluir
                  </button>
                </div>
              </div>
            </li>
          );
        })}
        {!midias.length && <li className="muted empty">Sem itens</li>}
      </ul>
    </div>
  );
}
