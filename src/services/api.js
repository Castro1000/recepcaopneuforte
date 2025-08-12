// src/services/api.js
import axios from "axios";

const baseURL = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

const api = axios.create({
  baseURL,             // ex.: https://recepcaopneuforte.onrender.com
  timeout: 20000,
});

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem("token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

export default api;
