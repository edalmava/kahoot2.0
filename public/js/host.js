const socket = io('/host');

let configuracion = null;
let miPin = '';

const pInicio = document.getElementById('pantalla-inicio');
const pLobby = document.getElementById('pantalla-lobby');
const pJuego = document.getElementById('pantalla-juego');
const btnCrear = document.getElementById('btn-crear');
const btnComenzar = document.getElementById('btn-comenzar');
btnCrear.disabled = true;

socket.on('configuracion', (data) => {
  configuracion = data;
  btnCrear.disabled = false;
});

async function solicitar(evento, payload) {
  if (!configuracion || !socket.connected) {
    throw new Error('Espera a que se establezca la conexión con el servidor.');
  }
  let response;
  try {
    response = await socket.timeout(configuracion.ackTimeoutMs).emitWithAck(evento, payload);
  } catch {
    throw new Error('No se recibió confirmación del servidor. Verifica el estado de la partida.');
  }
  if (!response.ok) throw new Error(response.error.message);
  return response.data;
}

btnCrear.addEventListener('click', async () => {
  btnCrear.disabled = true;
  const minimo = 10 ** (configuracion.pinLength - 1);
  const gamePin = Math.floor(minimo + Math.random() * minimo * 9).toString();
  try {
    const data = await solicitar('crear_partida', { gamePin });
    miPin = data.pin;
    pInicio.style.display = 'none';
    pLobby.style.display = 'block';
    document.getElementById('mostrar-pin').innerText = data.pin;
  } catch (error) {
    alert(error.message);
  } finally {
    btnCrear.disabled = false;
  }
});

socket.on('nuevo_jugador', (jugador) => {
  const lista = document.getElementById('lista-jugadores');
  const li = document.createElement('li');
  li.innerText = jugador.nickname;
  lista.appendChild(li);
  const contador = document.getElementById('contador');
  contador.innerText = Number(contador.innerText) + 1;
});

btnComenzar.addEventListener('click', async () => {
  btnComenzar.disabled = true;
  const pregunta = {
    titulo: '¿Cuál es el protocolo nativo de Socket.IO?',
    opciones: ['HTTP', 'WebSockets', 'FTP', 'SSH']
  };
  try {
    await solicitar('iniciar_juego', { gamePin: miPin });
    document.getElementById('respuestas-conteo').innerText = '0';
    const data = await solicitar('enviar_pregunta', { gamePin: miPin, pregunta });
    document.getElementById('texto-pregunta').innerText = data.titulo;
    data.opciones.forEach((opcion, indice) => {
      document.getElementById(`opc-${indice}`).innerText = opcion;
    });
    pLobby.style.display = 'none';
    pJuego.style.display = 'block';
  } catch (error) {
    alert(error.message);
  } finally {
    btnComenzar.disabled = false;
  }
});

socket.on('respuesta_recibida', (data) => {
  const contador = document.getElementById('respuestas-conteo');
  contador.innerText = Number(contador.innerText) + 1;
  console.log(`El alumno ${data.playerId} respondió la opción índice: ${data.respuesta}`);
});
