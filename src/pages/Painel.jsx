import './Painel.css';
import axios from 'axios';
import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

// use o que preferir:
// const API_BASE = 'http://localhost:3001';
const API_BASE = 'https://recepcaopneuforte.onrender.com';

// de fora do componente para não reconectar toda hora
const socket = io(API_BASE, { transports: ['websocket', 'polling'] });

export default function Painel() {
  const [fila, setFila] = useState([]);
  const [carroAtual, setCarroAtual] = useState(0);
  const [carroFinalizado, setCarroFinalizado] = useState(null);
  const [emDestaque, setEmDestaque] = useState(false);

  // ÁUDIO / AUTOPLAY
  const [audioOk, setAudioOk] = useState(false);        // conseguimos tocar áudio sem gesto?
  const [needsUnlock, setNeedsUnlock] = useState(false); // mostrar overlay "Pressione OK"?
  const audioElemsRef = useRef({});                      // guarda instâncias de Audio

  const intervaloRef = useRef(null);
  const timeoutDestaqueRef = useRef(null);

  // -------- helpers --------
  const corrigirPronunciaModelo = (modelo) => {
    const m = (modelo || '').toString().trim();
    const upper = m.toUpperCase();
    switch (upper) {
      case 'KWID': return 'cuidi';
      case 'BYD': return 'biu ai díi';
      case 'HB20': return 'agá bê vinte';
      case 'ONIX': return 'ônix';
      case 'T-CROSS': return 'tê cross';
      case 'HR-V': return 'agá érre vê';
      case 'CR-V': return 'cê érre vê';
      case 'FERRARI': return 'FÉRRARI';
      default: return m;
    }
  };

  const montaServicos = (c) =>
    [c?.servico, c?.servico2, c?.servico3].filter(Boolean).join(' | ');

  const buscarFila = async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/api/fila-servico`);
      if (Array.isArray(data)) setFila(data.slice(0, 7));
      else console.error('A resposta da API não é um array:', data);
    } catch (err) {
      console.error('Erro ao buscar fila:', err);
    }
  };

  // -------- áudio: pré-aquecimento para tentar liberar autoplay --------
  const prewarmAudio = async () => {
    // cria elementos e dá um "play" MUTED + pause (eleva engajamento em vários navegadores)
    const busina1 = new Audio('/busina.mp3');
    const motor   = new Audio('/motor.mp3');
    const freiada = new Audio('/freiada.mp3');
    const busina2 = new Audio('/busina.mp3');

    const audios = [busina1, motor, freiada, busina2];
    audioElemsRef.current = { busina1, motor, freiada, busina2 };

    try {
      for (const a of audios) {
        a.muted = true;
        a.volume = 0;
        // Alguns navegadores exigem que a mídia esteja carregada antes do play
        await a.play().catch(() => {});
        a.pause();
        a.currentTime = 0;
        a.muted = false;
        a.volume = 1.0;
      }
      // se chegamos aqui, em muitos casos conseguimos tocar depois sem gesto
      setAudioOk(true);
    } catch {
      // se falhar, deixamos audioOk como está (false) — e usamos o fallback se necessário
      setAudioOk(false);
    }
  };

  // Tenta tocar um áudio e retorna true/false se conseguiu
  const tryPlay = async (audio) => {
    try {
      await audio.play();
      return true;
    } catch {
      return false;
    }
  };

  // Desbloqueio via controle remoto (OK/setas geram keydown)
  const unlockByKey = async () => {
    // tenta tocar uma buzininha rapidinha como “gesto”
    const a = audioElemsRef.current.busina1 || new Audio('/busina.mp3');
    const ok = await tryPlay(a);
    if (ok) {
      setAudioOk(true);
      setNeedsUnlock(false);
    }
  };

  // 1) carga inicial + pré-aquecimento de áudio
  useEffect(() => {
    buscarFila();
    prewarmAudio();

    // se o navegador bloquear, ouvimos qualquer tecla do controle
    const onKey = () => unlockByKey();
    window.addEventListener('keydown', onKey, { passive: true });

    // em algumas TVs, visibilitychange ajuda a “acordar” áudio quando a aba fica ativa
    const onVis = () => { if (document.visibilityState === 'visible' && !audioOk) prewarmAudio(); };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) carrossel rotativo (pausa quando tem destaque)
  useEffect(() => {
    if (intervaloRef.current) clearInterval(intervaloRef.current);

    if (fila.length > 1 && !carroFinalizado) {
      intervaloRef.current = setInterval(() => {
        setCarroAtual((prev) => (prev + 1) % fila.length);
      }, 6000);
    } else {
      setCarroAtual(0);
    }

    return () => clearInterval(intervaloRef.current);
  }, [fila, carroFinalizado]);

  // 3) sockets: finalização + novo carro (REGISTRA UMA VEZ)
  useEffect(() => {
    const onCarroFinalizado = async (carro) => {
      setCarroFinalizado(carro);
      setEmDestaque(true);

      // Sons na sequência (com fallback para desbloqueio)
      const { busina1, motor, freiada, busina2 } = audioElemsRef.current;
      try {
        // tenta tocar; se primeiro falhar, mostra overlay para apertar OK
        let ok = await tryPlay(motor || new Audio('/motor.mp3'));
        if (!ok) {
          setNeedsUnlock(true); // mostra “Pressione OK”
          // não retornamos; deixamos o overlay e, assim que o usuário apertar OK,
          // os próximos eventos tocarão normalmente
        } else {
          // sequência
          await tryPlay(busina1 || new Audio('/busina.mp3'));
          if (motor) {
            motor.onloadedmetadata = () => {
              const meioMotor = (motor.duration / 2) * 1000;
              setTimeout(() => { tryPlay(freiada || new Audio('/freiada.mp3')); }, meioMotor);
            };
          }
          // quando “motor” acabar, buzina e TTS
          if (motor) {
            motor.onended = async () => {
              await tryPlay(busina2 || new Audio('/busina.mp3'));
              anunciarCarro(carro);
            };
          } else {
            // sem instância pré-criada, chamamos o TTS com pequeno atraso
            setTimeout(() => anunciarCarro(carro), 800);
          }
        }
      } catch (e) {
        console.warn('Erro no áudio/fala:', e);
      }

      // remove da fila e ajusta índice
      setFila((prev) => {
        const nova = prev.filter((c) => c.id !== carro.id);
        setCarroAtual((idx) => (idx >= nova.length ? 0 : idx));
        return nova;
      });

      // mantém o destaque por 30s e garante limpeza
      if (timeoutDestaqueRef.current) clearTimeout(timeoutDestaqueRef.current);
      timeoutDestaqueRef.current = setTimeout(() => {
        setCarroFinalizado(null);
        setEmDestaque(false);
      }, 30000); // 30s
    };

    const onNovoCarroAdicionado = () => buscarFila();

    socket.on('carroFinalizado', onCarroFinalizado);
    socket.on('novoCarroAdicionado', onNovoCarroAdicionado);

    return () => {
      socket.off('carroFinalizado', onCarroFinalizado);
      socket.off('novoCarroAdicionado', onNovoCarroAdicionado);
      if (timeoutDestaqueRef.current) clearTimeout(timeoutDestaqueRef.current);
    };
  }, []);

  // 4) Guard extra: se por algum motivo carroFinalizado sumir, desliga overlay
  useEffect(() => {
    if (!carroFinalizado && emDestaque) setEmDestaque(false);
  }, [carroFinalizado, emDestaque]);

  const anunciarCarro = (carro) => {
    try {
      if (!('speechSynthesis' in window)) return;
      const ajustarLetra = (letra) => {
        const mapa = { Q: 'quê', W: 'dáblio', Y: 'ípsilon', E: 'é' };
        return mapa[letra.toUpperCase()] || letra.toUpperCase();
      };
      const placaSeparada = (carro.placa || '')
        .toString()
        .toUpperCase()
        .split('')
        .map(ajustarLetra)
        .join(' ');
      const modeloCorrigido = corrigirPronunciaModelo(carro.modelo);
      const frase = `Carro ${modeloCorrigido}, placa ${placaSeparada}, cor ${carro.cor}, dirija-se ao caixa.`;

      const falar = (texto) => {
        const u = new SpeechSynthesisUtterance(texto);
        u.lang = 'pt-BR';
        u.volume = 1;
        u.rate = 1.0;
        window.speechSynthesis.speak(u);
      };

      falar(frase);
      setTimeout(() => falar(frase), 2500);
    } catch (e) {
      console.warn('Erro no TTS:', e);
    }
  };

  const carroDestaque = carroFinalizado || fila[carroAtual];

  return (
    <div className="painel">
      {/* Overlay de desbloqueio (só aparece se precisar) */}
      {needsUnlock && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)',
            zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            textAlign: 'center', padding: 24
          }}
          // também capturamos clique caso a TV dispare "OK" como click
          onClick={unlockByKey}
        >
          <div>
            <div style={{ fontSize: '3rem', color: '#0ff', textShadow: '0 0 10px #0ff', fontWeight: 800 }}>
              Pressione <span style={{ color: '#fff' }}>OK</span> no controle
            </div>
            <div style={{ fontSize: '1.5rem', color: '#ddd', marginTop: 12 }}>
              para habilitar os sons das chamadas
            </div>
          </div>
        </div>
      )}

      <div className="topo">
        {/* ESQUERDA: logo */}
        <div className="titulo" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img
            src="/img/logo_pneuforte.png"
            alt="Pneu Forte"
            style={{ height: 65, objectFit: 'contain' }}
          />
        </div>

        {/* DIREITA: título */}
        <div
          className="previsao"
          style={{
            fontSize: '3rem',
            fontWeight: 800,
            letterSpacing: '2px',
            textTransform: 'uppercase',
            textShadow: '0 0 10px cyan'
          }}
        >
          LISTA DE ESPERA
        </div>
      </div>

      <div className="conteudo">
        <div className={`principal ${emDestaque ? 'destaque-finalizado' : ''}`}>
          {carroDestaque ? (
            <div className="conteudo-finalizado">
              <img
                src={carroFinalizado ? '/img/finalizado.gif' : '/img/carro_pneu_forte.png'}
                alt="Carro"
                className="imagem-principal"
              />
              <div className="info-carro">
                {carroFinalizado && (
                  <div className="texto-finalizado">🚗 CARRO FINALIZADO ✅</div>
                )}
                <h2>{carroDestaque.modelo?.toUpperCase()}</h2>
                <p>🔖 Placa: {carroDestaque.placa}</p>
                <p>🎨 Cor: {carroDestaque.cor}</p>
                <p>🔧 Serviços: {montaServicos(carroDestaque) || '-'}</p>
              </div>
            </div>
          ) : (
            <div className="conteudo-finalizado">
              <img
                src="/img/carro_pneu_forte.png"
                alt="Carro"
                className="imagem-principal"
              />
              <div className="info-carro">
                <h2>Sem carros na fila</h2>
              </div>
            </div>
          )}
        </div>

        <div className="lista-lateral">
          {fila.map((carro, index) =>
            index !== carroAtual ? (
              <div key={carro.id} className="card-lateral">
                <img src="/img/carro_pneu_forte.png" alt="Carro" className="miniatura" />
                <div>
                  <h3> 🚘 {carro.modelo?.toUpperCase()} 🚘</h3>
                  <p> 🔖 Placa: {carro.placa}</p>
                  <p> 🔧 Serviços: {montaServicos(carro) || '-'}</p>
                </div>
              </div>
            ) : null
          )}
        </div>
      </div>

      <div className="parceiros">
        <div className="lista-parceiros">
          <div className="logos-scroll">
            {[...Array(2)].flatMap((_, i) => [
              <img key={`p1-${i}`} src="/img/logo_parceiro1.png" alt="Parceiro 1" className="logo-parceiro" />,
              <img key={`p2-${i}`} src="/img/logo_parceiro2.png" alt="Parceiro 2" className="logo-parceiro" />,
              <img key={`p3-${i}`} src="/img/logo_parceiro3.png" alt="Parceiro 3" className="logo-parceiro" />,
              <img key={`p4-${i}`} src="/img/logo_parceiro4.png" alt="Parceiro 4" className="logo-parceiro" />,
              <img key={`p5-${i}`} src="/img/logo_parceiro5.png" alt="Parceiro 5" className="logo-parceiro" />,
              <img key={`p6-${i}`} src="/img/logo_parceiro6.png" alt="Parceiro 6" className="logo-parceiro" />,
              <img key={`p7-${i}`} src="/img/logo_parceiro7.png" alt="Parceiro 7" className="logo-parceiro" />,
              <img key={`p8-${i}`} src="/img/logo_parceiro8.png" alt="Parceiro 8" className="logo-parceiro" />,
              <img key={`p9-${i}`} src="/img/logo_parceiro9.jpg" alt="Parceiro 9" className="logo-parceiro" />,
              <img key={`p10-${i}`} src="/img/logo_parceiro10.png" alt="Parceiro 10" className="logo-parceiro" />,
              <img key={`p11-${i}`} src="/img/logo_parceiro11.jpg" alt="Parceiro 11" className="logo-parceiro" />,
            ])}
          </div>
        </div>
      </div>
    </div>
  );
}
