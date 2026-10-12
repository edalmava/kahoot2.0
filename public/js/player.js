const socket = io('/player');

let configuracion = null;
let miPinActual = '';
let preguntaIdActual = '';
let enviandoRespuesta = false;

const pLogin = document.getElementById('pantalla-login');
const pEspera = document.getElementById('pantalla-espera');
const pBotones = document.getElementById('pantalla-botones');
const btnUnirse = document.getElementById('btn-unirse');
const errorMsg = document.getElementById('error-msg');
btnUnirse.disabled = true;

socket.on('configuracion', (data) => {
  configuracion = data;
  btnUnirse.disabled = false;
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

btnUnirse.addEventListener('click', async () => {
  const gamePin = document.getElementById('input-pin').value;
  const nickname = document.getElementById('input-nick').value;
  errorMsg.innerText = '';
  btnUnirse.disabled = true;
  try {
    const data = await solicitar('unirse_a_partida', { gamePin, nickname });
    miPinActual = data.pin;
    pLogin.style.display = 'none';
    pEspera.style.display = 'block';
  } catch (error) {
    errorMsg.innerText = error.message;
  } finally {
    btnUnirse.disabled = false;
  }
});

socket.on('juego_iniciado', () => {
  pEspera.style.display = 'none';
});

socket.on('recibir_pregunta', (pregunta) => {
  preguntaIdActual = pregunta.preguntaId;
  enviandoRespuesta = false;
  pEspera.style.display = 'none';
  pBotones.style.display = 'block';
  document.querySelectorAll('.btn-opcion').forEach((boton) => {
    boton.disabled = false;
  });
});

async function responder(indiceOpcion) {
  if (enviandoRespuesta || !preguntaIdActual) return;
  const preguntaId = preguntaIdActual;
  enviandoRespuesta = true;
  document.querySelectorAll('.btn-opcion').forEach((boton) => {
    boton.disabled = true;
  });

  try {
    await solicitar('enviar_respuesta', {
      gamePin: miPinActual,
      preguntaId,
      respuestaSeleccionada: indiceOpcion
    });
    if (preguntaId === preguntaIdActual) {
      alert('Respuesta recibida por el servidor. Espera al profesor.');
    }
  } catch (error) {
    if (preguntaId === preguntaIdActual) alert(error.message);
  }
}
