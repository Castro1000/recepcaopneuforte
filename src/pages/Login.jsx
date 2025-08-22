import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

const Login = () => {
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // helpers para normalizar e decidir rota
  const strip = (s='') => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const toTipo = (s='') => strip(String(s).trim()).toUpperCase();

  const decidePath = (tipo='') => {
    const t = toTipo(tipo);
    if (['RECEPCAO','PAINEL','TV'].includes(t)) return '/painel';
    if (['VENDEDOR','BALCAO'].includes(t))     return '/balcao';
    if (['MIDIA'].includes(t))                 return '/midia';   // 👈 NOVO
    if (['ADMIN','ADMINISTRADOR'].includes(t)) return '/admin';
    return '/balcao';
  };

  const parseJwt = (token) => {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
      );
      return JSON.parse(json);
    } catch { return null; }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setErro('');

    if (!usuario || !senha) {
      setErro('Informe usuário e senha.');
      return;
    }

    try {
      setLoading(true);
      const { data } = await api.post('/api/login', { usuario, senha });
      // backend deve retornar { token, tipo, redirect }
      const token = data?.token;
      if (!token) {
        setErro('Resposta inesperada do servidor.');
        return;
      }

      // guarda infos úteis
      localStorage.setItem('token', token);
      localStorage.setItem('usuario', usuario);
      if (data?.tipo) localStorage.setItem('tipo', data.tipo);
      if (data?.user) localStorage.setItem('user', JSON.stringify(data.user));

      // prioridade: usar redirect enviado pelo backend
      let dest = data?.redirect;

      // fallback: decidir pelo tipo retornado ou pelo claim do JWT
      if (!dest) {
        const tipoResp = data?.tipo || data?.user?.perfil;
        let tipo = tipoResp ? toTipo(tipoResp) : '';
        if (!tipo) {
          const payload = parseJwt(token);
          tipo = toTipo(payload?.tipo || '');
        }
        dest = decidePath(tipo);
      }

      navigate(dest, { replace: true });
    } catch (err) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.message;

      if (status === 401) setErro('Usuário ou senha inválidos');
      else if (status === 400) setErro('Informe usuário e senha.');
      else if (msg === 'DB_ERROR') setErro('Falha na conexão com o banco. Tente novamente.');
      else if (err?.code === 'ERR_NETWORK' || err?.code === 'ECONNABORTED') {
        setErro('Servidor indisponível no momento. Tente novamente em instantes.');
      } else {
        setErro(`Erro no servidor${status ? ` (${status})` : ''}.`);
      }
      console.error('[LOGIN ERROR]', err);
    } finally {
      setLoading(false);
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
            autoComplete="username"
          />
          <input
            type="password"
            placeholder="Senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            style={styles.input}
            autoComplete="current-password"
          />
          <button
            type="submit"
            style={{ ...styles.button, opacity: loading ? 0.7 : 1 }}
            disabled={loading}
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
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
    outline: 'none',
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
