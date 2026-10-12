const socket = io('/host');

let configuracion = null;
let miPin = '';
let preguntaIdActual = '';
let versionConexion = 0;
let totalAceptado = 0;

const pInicio = document.getElementById('pantalla-inicio');
const pLobby = document.getElementById('pantalla-lobby');
const pJuego = document.getElementById('pantalla-juego');
const btnCrear = document.getElementById('btn-crear');
const btnComenzar = document.getElementById('btn-comenzar');
const estadoHost = document.getElementById('estado-host');
btnCrear.disabled = true;
btnComenzar.disabled = true;

socket.on('configuracion', (data) => {
  configuracion = data;
  btnCrear.disabled = false;
});

socket.on('disconnect', () => {
  versionConexion++;
  configuracion = null;
  miPin = '';
  preguntaIdActual = '';
  totalAceptado = 0;
  btnCrear.disabled = true;
  btnComenzar.disabled = true;
  pInicio.style.display = 'block';
  pLobby.style.display = 'none';
  pJuego.style.display = 'none';
  document.getElementById('lista-jugadores').innerText = '';
  document.getElementById('contador').innerText = '0';
  estadoHost.innerText = 'Conexión interrumpida. La partida ha terminado; al reconectar puedes crear otra.';
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
  if (!configuracion || !socket.connected) return;
  const version = versionConexion;
  btnCrear.disabled = true;
  const minimo = 10 ** (configuracion.pinLength - 1);
  const gamePin = Math.floor(minimo + Math.random() * minimo * 9).toString();
  try {
    const data = await solicitar('crear_partida', { gamePin });
    if (version !== versionConexion) return;
    miPin = data.pin;
    estadoHost.innerText = '';
    btnComenzar.disabled = false;
    pInicio.style.display = 'none';
    pLobby.style.display = 'block';
    document.getElementById('mostrar-pin').innerText = data.pin;
  } catch (error) {
    if (version === versionConexion) estadoHost.innerText = error.message;
  } finally {
    if (version === versionConexion) btnCrear.disabled = !socket.connected;
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
  if (!configuracion || !socket.connected || !miPin) return;
  const version = versionConexion;
  btnComenzar.disabled = true;
  const pregunta = {
    titulo: '¿Cuál es el protocolo nativo de Socket.IO?',
    opciones: ['HTTP', 'WebSockets', 'FTP', 'SSH']
  };
  try {
    await solicitar('iniciar_juego', { gamePin: miPin });
    if (version !== versionConexion) return;
    const data = await solicitar('enviar_pregunta', { gamePin: miPin, pregunta });
    if (version === versionConexion && !preguntaIdActual) mostrarPregunta(data);
  } catch (error) {
    if (version === versionConexion) alert(error.message);
  } finally {
    if (version === versionConexion) btnComenzar.disabled = !socket.connected;
  }
});

function mostrarPregunta(data) {
  if (data.preguntaId === preguntaIdActual) return;
  preguntaIdActual = data.preguntaId;
  totalAceptado = 0;
  document.getElementById('respuestas-conteo').innerText = '0';
  document.getElementById('estado-pregunta').innerText = 'Pregunta abierta. Esperando respuestas.';
  document.getElementById('texto-pregunta').innerText = data.titulo;
  data.opciones.forEach((opcion, indice) => {
    document.getElementById(`opc-${indice}`).innerText = opcion;
  });
  pLobby.style.display = 'none';
  pJuego.style.display = 'block';
}

socket.on('recibir_pregunta', mostrarPregunta);

socket.on('pregunta_cerrada', ({ preguntaId }) => {
  if (preguntaId !== preguntaIdActual) return;
  document.getElementById('estado-pregunta').innerText = 'Pregunta cerrada. El plazo ha terminado.';
});

socket.on('respuesta_recibida', (data) => {
  if (data.preguntaId !== preguntaIdActual) return;
  totalAceptado = Math.max(totalAceptado, data.totalAceptado);
  const contador = document.getElementById('respuestas-conteo');
  contador.innerText = String(totalAceptado);
});
