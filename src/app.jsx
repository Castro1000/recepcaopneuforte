import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Balcao from './pages/Balcao';
import Painel from './pages/Painel';

const App = () => {
  const isAuthenticated = !!localStorage.getItem('token');

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/login" />} />
        <Route path="/login" element={<Login />} />
        <Route path="/balcao" element={isAuthenticated ? <Balcao /> : <Navigate to="/login" />} />
        <Route path="/painel" element={<Painel />} />
      </Routes>
    </Router>
  );
};

export default App;