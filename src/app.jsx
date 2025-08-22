// src/app.jsx
import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";

import Login from "./pages/Login";
import Balcao from "./pages/Balcao";
import Painel from "./pages/Painel";
import Admin from "./pages/Admin";
import Midia from "./pages/Midia";

/* --------- helpers simples de auth --------- */
function parseJwt(token) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getAuth() {
  const token = localStorage.getItem("token");
  if (!token) return { ok: false };
  const payload = parseJwt(token);
  if (!payload) {
    localStorage.removeItem("token");
    return { ok: false };
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    localStorage.removeItem("token");
    return { ok: false };
  }
  const tipo = String(payload.tipo || "").toUpperCase();
  return { ok: true, token, tipo };
}

/* 
  Protege rotas. Se "roles" for passado, confere o cargo do token.
  Se não tiver token => manda para /login.
  Se tiver token mas não tiver permissão => também manda /login (simples).
*/
const ProtectedRoute = ({ children, roles }) => {
  const auth = getAuth();
  if (!auth.ok) return <Navigate to="/login" replace />;

  if (roles && roles.length) {
    const allow = roles.map((r) => String(r).toUpperCase());
    if (!allow.includes(auth.tipo)) {
      return <Navigate to="/login" replace />;
    }
  }
  return children;
};

export default function App() {
  return (
    <Router>
      <Routes>
        {/* Sempre abre o Login na raiz */}
        <Route path="/" element={<Login />} />
        <Route path="/login" element={<Login />} />

        <Route
          path="/balcao"
          element={
            <ProtectedRoute>
              <Balcao />
            </ProtectedRoute>
          }
        />

        <Route
          path="/painel"
          element={
            <ProtectedRoute>
              <Painel />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={["ADMIN", "ADMINISTRADOR"]}>
              <Admin />
            </ProtectedRoute>
          }
        />

        <Route
          path="/midia"
          element={
            <ProtectedRoute roles={["MIDIA", "ADMIN", "ADMINISTRADOR"]}>
              <Midia />
            </ProtectedRoute>
          }
        />

        {/* fallback: qualquer rota desconhecida leva ao login */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}
