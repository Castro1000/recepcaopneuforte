// src/pages/Midia.jsx
import React, { useEffect, useRef, useState } from "react";
import "./Midia.css";

// ===== Ajuste conforme ambiente =====
const API_BASE = "https://recepcaopneuforte.onrender.com";
// const API_BASE = "http://localhost:3001";

const DEFAULT_DURATION_MS = 8000;   // imagens
const DEFAULT_SEQ_STEP_MS = 10000;  // imagens

// ===== Helpers =====
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

// Converte "2025-08-29T14:36" (local) -> string UTC "YYYY-MM-DD HH:MM:SS"
const localInputToMySQLUTC = (val) => {
  if (!val) return "";
  const d = new Date(val); // interpreta como horário local do usuário
  const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19) // YYYY-MM-DDTHH:mm:ss
    .replace("T", " ");
  return iso;
};

// Interpreta string vinda do servidor:
//  - se for "YYYY-MM-DD HH:mm[:ss]" (naive), trata como UTC e devolve Date local
//  - se vier com Z/offset, deixa o JS converter
const serverStringToLocalDate = (s) => {
  if (!s) return null;
  const str = String(s).trim();
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m && !/[zZ]|[+\-]\d{2}:?\d{2}$/.test(str)) {
    const [, y, M, d, h, mi, sec = "00"] = m;
    const msUtc = Date.UTC(+y, +M - 1, +d, +h, +mi, +sec);
    return new Date(msUtc); // objeto Date na hora local
  }
  const t = Date.parse(str);
  return Number.isFinite(t) ? new Date(t) : null;
};

// Para preencher <input type="datetime-local">
const toInputValueFromServer = (s) => {
  const d = serverStringToLocalDate(s);
  if (!d || isNaN(d)) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

export default function Midia() {
  // grava ?token=... no localStorage (útil no Render)
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    if (t) localStorage.setItem("token", t);
  }, []);

  const token = (localStorage.getItem("token") || "").trim();

  const makeUrl = (pathOrFull) => {
    if (!pathOrFull) return "";
    if (/^(https?:)?\/\//i.test(pathOrFull) || pathOrFull.startsWith("blob:") || pathOrFull.startsWith("data:")) {
      return pathOrFull;
    }
    return `${API_BASE}${pathOrFull}`;
  };

  async function apiAuth(path, opt = {}) {
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
      if (resp.status === 401) {
        throw new Error("token_required: faça login neste domínio para continuar.");
      }
      throw new Error(detail || `HTTP ${resp.status}`);
    }

    try { return await resp.json(); } catch { return {}; }
  }

  // --- estado ---
  const [midias, setMidias] = useState([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const fileInputRef = useRef(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const [form, setForm] = useState({
    titulo: "",
    files: [],
    data_inicio: "",
    data_fim: "",
    intervalo_minutos: 15,
    durationValue: 8,      // images
    durationUnit: "s",
    seq_step_sec: 10,      // images (multi)
  });

  // edição
  const [edit, setEdit] = useState(null);

  // --- carregar lista ---
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

  useEffect(() => { carregarMidias(); /* eslint-disable-line */ }, []);

  // --- seleção de arquivos ---
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

  // --- salvar (upload) ---
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
    if (!token) {
      setErr("É necessário estar logado neste domínio (token ausente).");
      return;
    }

    const isVideo = form.files[0].type.startsWith("video/");
    const image_duration_ms = isVideo ? "" : humanToMs(form.durationValue, form.durationUnit);
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

        // Enviar **em UTC** no formato do MySQL (sem Z) para bater com o servidor/DB (UTC).
        fd.append("data_inicio", localInputToMySQLUTC(form.data_inicio));
        fd.append("data_fim",     localInputToMySQLUTC(form.data_fim));

        fd.append("intervalo_minutos", String(intervaloMin));

        if (!isVideo) {
          fd.append("image_duration_ms", String(image_duration_ms));
          fd.append("seq_enabled", String(seq_enabled ? 1 : 0));
          fd.append("seq_count", String(seq_enabled ? form.files.length : 1));
          fd.append("seq_step_ms", String(seq_enabled ? seq_step_ms : 0));
        }

        const endpoint = `/api/midia?ts=${Date.now()}&uid=${Math.random().toString(36).slice(2)}`;
        await apiAuth(endpoint, { method: "POST", body: fd });
        okCount++;
      }

      setMsg(
        form.files[0].type.startsWith("video/")
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

  // --- excluir ---
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

  // --- editar (PATCH) ---
  const abrirEdicao = (m) => {
    setEdit({
      id: m.id,
      titulo: m.titulo || "",
      data_inicio: toInputValueFromServer(m.data_inicio),
      data_fim: toInputValueFromServer(m.data_fim),
      intervalo_minutos: Number(m.intervalo_minutos ?? m.intervalo_minuto ?? 15),
    });
  };

  const salvarEdicao = async () => {
    try {
      setErr(""); setMsg("");
      const body = {
        titulo: edit.titulo,
        data_inicio: localInputToMySQLUTC(edit.data_inicio),
        data_fim:     localInputToMySQLUTC(edit.data_fim),
        intervalo_minutos: toInt(edit.intervalo_minutos, 15),
      };
      await apiAuth(`/api/midia/${edit.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setMsg("Mídia atualizada.");
      setEdit(null);
      carregarMidias();
    } catch (e) {
      console.error(e);
      setErr(`Falha ao atualizar: ${e.message}`);
    }
  };

  const resolveUrl = (u) => makeUrl(u);

  const isMultiImage = form.files.length > 1 && form.files.every((f) => f.type.startsWith("image/"));
  const isVideoSel = form.files.length === 1 && form.files[0]?.type.startsWith("video/");
  const tempoMs = humanToMs(form.durationValue, form.durationUnit);

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

          {/* Tempo na tela apenas para IMAGENS */}
          {!isVideoSel && (
            <div className="grid-2">
              <div className="field">
                <label>Tempo na tela (apenas imagens)</label>
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
          )}

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
          const dIni = serverStringToLocalDate(m.data_inicio);
          const dFim = serverStringToLocalDate(m.data_fim);
          return (
            <li key={m.id}>
              <div className="item-grid">
                <div>
                  <strong>{m.titulo || "(sem título)"}</strong>
                  <div className="muted meta">
                    {(m.tipo === "IMG" ? "Imagem" : "Vídeo")}
                    {m.tipo === "IMG"
                      ? ` · fica ${msToHuman(Number(m.image_duration_ms) || DEFAULT_DURATION_MS)} na tela`
                      : ` · duração do próprio vídeo`}
                    {m.intervalo_minutos != null ? ` · Intervalo: ${m.intervalo_minutos} min` : ""}
                  </div>
                  {(m.data_inicio || m.data_fim) && (
                    <div className="muted meta">
                      {dIni ? `Início: ${dIni.toLocaleString()}` : ""}
                      {dIni && dFim ? " · " : ""}
                      {dFim ? `Término: ${dFim.toLocaleString()}` : ""}
                    </div>
                  )}
                  <div className="preview">
                    {m.tipo === "IMG" ? (
                      <img src={resolveUrl(m.url)} alt={m.titulo || "img"} />
                    ) : (
                      <video src={resolveUrl(m.url)} muted controls />
                    )}
                  </div>
                </div>
                <div className="right-actions">
                  <button className="btn" onClick={() => abrirEdicao(m)}>Editar</button>
                  <button className="btn danger" onClick={() => excluir(m.id)}>Excluir</button>
                </div>
              </div>
            </li>
          );
        })}
        {!midias.length && <li className="muted empty">Sem itens</li>}
      </ul>

      {/* MODAL EDIÇÃO */}
      {edit && (
        <div className="modal">
          <div className="card">
            <h4>Editar mídia #{edit.id}</h4>
            <div className="field">
              <label>Título</label>
              <input
                type="text"
                value={edit.titulo}
                onChange={(e) => setEdit({ ...edit, titulo: e.target.value })}
              />
            </div>
            <div className="grid-2">
              <div className="field">
                <label>Início</label>
                <input
                  type="datetime-local"
                  value={edit.data_inicio}
                  onChange={(e) => setEdit({ ...edit, data_inicio: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Término</label>
                <input
                  type="datetime-local"
                  value={edit.data_fim}
                  onChange={(e) => setEdit({ ...edit, data_fim: e.target.value })}
                />
              </div>
            </div>
            <div className="field">
              <label>Mostrar novamente a cada (min)</label>
              <input
                type="number"
                min="1"
                value={edit.intervalo_minutos}
                onChange={(e) => setEdit({ ...edit, intervalo_minutos: toInt(e.target.value, 15) })}
              />
            </div>

            <div className="actions">
              <button className="btn" onClick={() => setEdit(null)}>Cancelar</button>
              <button className="btn primary" onClick={salvarEdicao}>Salvar alterações</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
