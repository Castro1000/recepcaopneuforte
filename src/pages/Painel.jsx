import './Painel.css';
import axios from 'axios';
import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

const socket = io('https://recepcaopneuforte.onrender.com');
//const socket = io('http://localhost:3001');

export default function Painel() {
  const [fila, setFila] = useState([]);
  const [carroAtual, setCarroAtual] = useState(0);
  const [carroFinalizado, setCarroFinalizado] = useState(null);
  const [emDestaque, setEmDestaque] = useState(false);
  const intervaloRef = useRef(null);

  useEffect(() => {
    const buscarFila = async () => {
      try {
        const response = await axios.get('https://recepcaopneuforte.onrender.com/api/fila-servico');
        //const response = await axios.get('http://localhost:3001/api/fila-servico');
        if (Array.isArray(response.data)) {
          setFila(response.data.slice(0, 7));
        } else {
          console.error('A resposta da API não é um array:', response.data);
        }
      } catch (error) {
        console.error('Erro ao buscar fila:', error);
      }
    };

    buscarFila();
  }, []);

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

  useEffect(() => {
    const fetchFila = async () => {
      try {
        const response = await axios.get('https://recepcaopneuforte.onrender.com/api/fila-servico');
        //const response = await axios.get('http://localhost:3001/api/fila-servico');
        if (Array.isArray(response.data)) setFila(response.data.slice(0, 7));
      } catch (error) {
        console.error('Erro ao atualizar fila via socket:', error);
      }
    };

    socket.on('carroFinalizado', async (carro) => {
      setCarroFinalizado(carro);
      setEmDestaque(true);

      const busina1 = new Audio('/busina.mp3');
      const motor = new Audio('/motor.mp3');
      const freiada = new Audio('/freiada.mp3');
      const busina2 = new Audio('/busina.mp3');

      try {
        motor.play();
        busina1.play();

        motor.onloadedmetadata = () => {
          const meioMotor = (motor.duration / 2) * 1000;
          setTimeout(() => freiada.play(), meioMotor);
        };

        motor.onended = () => {
          busina2.play();
          busina2.onended = () => {
            const ajustarLetra = (letra) => {
              const mapa = { Q: 'quê', W: 'dáblio', Y: 'ípsilon' };
              return mapa[letra.toUpperCase()] || letra.toUpperCase();
            };
            const placaSeparada = carro.placa
              ?.toString()
              .toUpperCase()
              .split('')
              .map(ajustarLetra)
              .join(' ');

            const modeloCorrigido = corrigirPronunciaModelo(carro.modelo);
            const frase = `Carro ${modeloCorrigido}, placa ${placaSeparada}, cor ${carro.cor}, dirija-se ao caixa.`;

            const falar = (texto) => {
              const u = new SpeechSynthesisUtterance(texto);
              u.lang = 'pt-BR';
              u.volume = 1.0;
              u.rate = 1.0;
              speechSynthesis.speak(u);
            };

            falar(frase);
            setTimeout(() => falar(frase), 2500);
          };
        };
      } catch (e) {
        console.warn('Erro no áudio ou fala:', e);
      }

      setFila((prevFila) => {
        const novaFila = prevFila.filter((c) => c.id !== carro.id);
        if (carroAtual >= novaFila.length) setCarroAtual(0);
        return novaFila;
      });

      setTimeout(() => {
        setCarroFinalizado(null);
        setEmDestaque(false);
      }, 30000);
    });

    socket.on('novoCarroAdicionado', () => {
      fetchFila();
    });

    return () => {
      socket.off('carroFinalizado');
      socket.off('novoCarroAdicionado');
    };
  }, [carroAtual]);

  // Corrige pronúncia de alguns modelos
  const corrigirPronunciaModelo = (modelo) => {
    const m = (modelo || '').toString().trim();
    const upper = m.toUpperCase();
    switch (upper) {
      case 'KWID': return 'Quíi di';
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

  const carroDestaque = carroFinalizado || fila[carroAtual];

  // helper para montar "SERV1 | SERV2 | SERV3"
  const montaServicos = (c) =>
    [c?.servico, c?.servico2, c?.servico3].filter(Boolean).join(' | ');

  return (
    <div className="painel">
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
          {carroDestaque && (
            <div className="conteudo-finalizado">
              <img
                src={carroFinalizado ? "/img/carro_finalizado.png" : "/img/carro_pneu_forte.png"}
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

                {/* serviços unidos por | */}
                <p>🔧 Serviços: {montaServicos(carroDestaque) || '-'}</p>
              </div>
            </div>
          )}
        </div>

        <div className="lista-lateral">
          {fila.map((carro, index) => (
            index !== carroAtual && (
              <div key={carro.id} className="card-lateral">
                <img src="/img/carro_pneu_forte.png" alt="Carro" className="miniatura" />
                <div>
                  <h3>{carro.modelo?.toUpperCase()}</h3>
                  <p>{carro.placa}</p>
                  {/* serviços unidos por | */}
                  <p>{montaServicos(carro) || '-'}</p>
                </div>
              </div>
            )
          ))}
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
