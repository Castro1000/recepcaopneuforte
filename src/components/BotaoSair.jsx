// src/components/BotaoSair.jsx
import React from "react";
import { useNavigate } from "react-router-dom";
import "./BotaoSair.css";

const BotaoSair = () => {
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("tipo");
    navigate("/login"); // leva direto pro login
  };

  return (
    <button className="botao-sair" onClick={handleLogout}>
      ⏻ Sair
    </button>
  );
};

export default BotaoSair;
