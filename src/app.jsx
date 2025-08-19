// src/App.jsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Balcao from './pages/Balcao';
import Painel from './pages/Painel';
import Admin from './pages/Admin';

const App = () => {
  const isAuthenticated = !!localStorage.getItem('token');

  // Wrapper simples para proteger rotas
  const ProtectedRoute = ({ children }) => {
    return isAuthenticated ? children : <Navigate to="/login" replace />;
  };

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/login" />} />
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
            <ProtectedRoute>
              <Admin />
            </ProtectedRoute>
          }
        />
      </Routes>
    </Router>
  );
};

export default App;
