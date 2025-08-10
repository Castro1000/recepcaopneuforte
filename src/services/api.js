// src/services/api.js
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL, // ex.: https://recepcaopneuforte.onrender.com
  withCredentials: false,
});

export default api; // <- export default (importa como "api")
