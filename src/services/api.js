// src/services/api.js
import axios from "axios";

const resolveBaseURL = () => {
  const envUrl = (import.meta?.env?.VITE_API_BASE || "").trim();
  if (envUrl) return envUrl.replace(/\/+$/, ""); // usa .env se definido

  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return "http://localhost:3001"; // dev local
  }

  return ""; // produção: mesmo domínio do frontend
};

const api = axios.create({
  baseURL: resolveBaseURL(),
  timeout: 20000,
});

// Anexa token quando existir
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem("token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

export default api;
