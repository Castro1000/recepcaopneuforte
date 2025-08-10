import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';


const Login = () => {
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setErro('');

    try {
      const { data } = await api.post('/api/login', { usuario, senha });
      const { token, tipo } = data;

      localStorage.setItem('token', token);
      localStorage.setItem('usuario', usuario);
      localStorage.setItem('tipo', tipo);

      if (tipo === 'recepcao') {
        navigate('/painel');
      } else if (tipo === 'vendedor') {
        navigate('/balcao');
      } else {
        setErro('Tipo de usuário não reconhecido');
      }
    } catch (err) {
      console.error(err);
      setErro('Usuário ou senha inválidos');
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.box}>
        <h2 style={styles.title}>Login - Pneu Forte</h2>
        <form onSubmit={handleLogin} style={styles.form}>
          <input
            type="text"
            placeholder="Usuário"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            style={styles.input}
          />
          <input
            type="password"
            placeholder="Senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            style={styles.input}
          />
          <button type="submit" style={styles.button}>Entrar</button>
          {erro && <p style={styles.erro}>{erro}</p>}
        </form>
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    width: '100vw',
    backgroundColor: '#2d2d2d',
  },
  box: {
    backgroundColor: '#f2f2f2',
    padding: '30px',
    borderRadius: '10px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    width: '100%',
    maxWidth: '360px',
  },
  title: {
    marginBottom: '20px',
    textAlign: 'center',
    color: '#333',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  input: {
    padding: '10px',
    fontSize: '16px',
    border: '1px solid #ccc',
    borderRadius: '5px',
  },
  button: {
    padding: '10px',
    fontSize: '16px',
    backgroundColor: '#000',
    color: '#fff',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
  },
  erro: {
    color: 'red',
    fontSize: '14px',
    textAlign: 'center',
  },
};

export default Login;
