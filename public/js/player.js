const socket = io('/player');
const SESSION_KEY = 'kahoot.playerSession';
let configuracion = null;
let sesion = leerSesion();
let miPinActual = '';
let pinSolicitado = '';
let preguntaIdActual = '';
let preguntaActual = null;
let preguntaAbierta = false;
let respuestaConfirmada = null;
let estadoJugador = 'espera';
let sesionLista = false;
let recuperando = false;
let sesionReemplazada = false;
let versionConexion = 0;
let revisionPregunta = 0;
let envioEnCurso = null;
const preguntasCerradas = new Set();

const pLogin = document.getElementById('pantalla-login');
const pEspera = document.getElementById('pantalla-espera');
const pBotones = document.getElementById('pantalla-botones');
const btnUnirse = document.getElementById('btn-unirse');
const btnNuevaSesion = document.getElementById('btn-nueva-sesion');
const btnConsultar = document.getElementById('btn-consultar');
const panelSesion = document.getElementById('panel-sesion');
const estadoConexion = document.getElementById('estado-conexion');
const errorMsg = document.getElementById('error-msg');
const inputPin = document.getElementById('input-pin');
const inputNick = document.getElementById('input-nick');

function leerSesion() {
  try {
    const data = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (data && typeof data.pin === 'string' && /^[0-9]{4}$/.test(data.pin) &&
        typeof data.playerId === 'string' && data.playerId &&
        typeof data.token === 'string' && /^[a-f0-9]{64}$/.test(data.token) && typeof data.nickname === 'string') {
      const pendiente = data.pendiente;
      return {
        pin: data.pin, playerId: data.playerId, token: data.token, nickname: data.nickname,
        pendiente: pendiente && typeof pendiente.preguntaId === 'string' && pendiente.preguntaId &&
          Number.isInteger(pendiente.respuestaSeleccionada) && pendiente.respuestaSeleccionada >= 0 &&
          Number.isInteger(pendiente.intentos) && pendiente.intentos >= 0 ? pendiente : null
      };
    }
  } catch {}
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  return null;
}

function guardarSesion() {
  try {
    if (sesion) sessionStorage.setItem(SESSION_KEY, JSON.stringify(sesion));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {}
}

function mostrarEstado(estado, mensaje) {
  estadoJugador = estado;
  estadoConexion.innerText = mensaje;
  panelSesion.style.display = sesion || mensaje ? 'block' : 'none';
  pLogin.style.display = sesion ? 'none' : 'block';
  pEspera.style.display = sesion && !preguntaActual ? 'block' : 'none';
  pBotones.style.display = sesion && preguntaActual ? 'block' : 'none';
  document.querySelectorAll('.btn-opcion').forEach((boton) => {
    boton.disabled = !socket.connected || !sesionLista || recuperando || estado !== 'abierta';
  });
  btnUnirse.disabled = !configuracion || !socket.connected || recuperando || !!sesion || sesionReemplazada;
  btnConsultar.style.display = sesion && (!sesionLista || estado === 'pendiente') ? 'block' : 'none';
  btnConsultar.disabled = !configuracion || !socket.connected || recuperando || !!envioEnCurso;
}

function terminarSesion(mensaje) {
  versionConexion++;
  sesion = null;
  guardarSesion();
  miPinActual = '';
  pinSolicitado = '';
  preguntaActual = null;
  preguntaIdActual = '';
  preguntaAbierta = false;
  respuestaConfirmada = null;
  sesionLista = false;
  recuperando = false;
  envioEnCurso = null;
  preguntasCerradas.clear();
  errorMsg.innerText = mensaje;
  mostrarEstado('espera', mensaje);
}

async function solicitar(evento, payload) {
  if (!configuracion || !socket.connected) {
    const error = new Error('Conexión interrumpida. Esperando reconexión…');
    error.code = 'SIN_CONEXION';
    throw error;
  }
  let response;
  try {
    response = await socket.timeout(configuracion.ackTimeoutMs).emitWithAck(evento, payload);
  } catch {
    const error = new Error('Confirmación pendiente. No se recibió el acuse del servidor.');
    error.code = 'CONFIRMACION_PENDIENTE';
    throw error;
  }
  if (!response.ok) {
    const error = new Error(response.error.message);
    error.code = response.error.code;
    throw error;
  }
  return response.data;
}

function aplicarEstado(data, reintentar, aviso) {
  preguntaActual = data.pregunta;
  preguntaIdActual = preguntaActual?.preguntaId || '';
  preguntaAbierta = data.preguntaAbierta && !preguntasCerradas.has(preguntaIdActual);
  respuestaConfirmada = data.respuesta;
  sesionLista = true;
  recuperando = false;
  if (respuestaConfirmada || sesion.pendiente?.preguntaId !== preguntaIdActual || !preguntaAbierta || !reintentar ||
      sesion.pendiente?.intentos >= configuracion.maxRetries + 1) {
    sesion.pendiente = null;
    guardarSesion();
  }
  const motivo = aviso ? `${aviso} ` : '';
  if (respuestaConfirmada) mostrarEstado('aceptada', `${motivo}Respuesta aceptada. Espera al profesor.`);
  else if (!preguntaActual) mostrarEstado('espera', `${motivo}Esperando la siguiente pregunta del profesor.`);
  else if (!preguntaAbierta) mostrarEstado('cerrada', `${motivo}Pregunta cerrada. No se registró una respuesta.`);
  else if (sesion.pendiente) mostrarEstado('pendiente', 'Confirmación pendiente. Reintentando la misma respuesta…');
  else mostrarEstado('abierta', aviso ? `${aviso} Puedes elegir una opción.` : 'Pregunta abierta. Elige una opción.');
}

async function sincronizarEstado(version, reintentar = true, aviso = '') {
  recuperando = true;
  sesionLista = false;
  mostrarEstado('recuperando', `${aviso ? `${aviso} ` : ''}Consultando el estado de la partida…`);
  try {
    // Si llega una pregunta o cierre durante la consulta, pedir un snapshot posterior.
    while (version === versionConexion && socket.connected && sesion) {
      const revision = revisionPregunta;
      const data = await solicitar('consultar_estado', { gamePin: sesion.pin });
      if (version !== versionConexion) return;
      if (revision !== revisionPregunta) continue;
      aplicarEstado(data, reintentar, aviso);
      if (sesion.pendiente && !envioEnCurso) enviarPendiente();
      return;
    }
  } catch (error) {
    if (version !== versionConexion) return;
    recuperando = false;
    if (['SESION_INVALIDA', 'PARTIDA_NO_EXISTE', 'NO_PERTENECE'].includes(error.code)) terminarSesion(error.message);
    else mostrarEstado('pendiente', `${error.message} Consulta el estado para continuar.`);
  }
}

async function recuperarSesion() {
  if (!sesion || recuperando || !socket.connected) return;
  const version = versionConexion;
  recuperando = true;
  sesionLista = false;
  mostrarEstado('recuperando', 'Recuperando la sesión…');
  try {
    const data = await solicitar('reanudar_sesion', { gamePin: sesion.pin, token: sesion.token });
    if (version !== versionConexion) return;
    miPinActual = data.pin;
    await sincronizarEstado(version);
  } catch (error) {
    if (version !== versionConexion) return;
    recuperando = false;
    if (['SESION_INVALIDA', 'PARTIDA_NO_EXISTE'].includes(error.code)) terminarSesion(error.message);
    else mostrarEstado('pendiente', `${error.message} Consulta el estado para continuar.`);
  }
}

socket.on('configuracion', (data) => {
  configuracion = data;
  versionConexion++;
  inputPin.pattern = `[0-9]{${data.pinLength}}`;
  inputPin.minLength = data.pinLength;
  inputPin.maxLength = data.pinLength;
  document.getElementById('limites-nick').innerText = `Nombre: entre ${data.nicknameMinLength} y ${data.nicknameMaxLength} caracteres.`;
  if (sesion) recuperarSesion();
  else mostrarEstado('espera', '');
});

btnUnirse.addEventListener('click', async () => {
  if (recuperando || sesion || !configuracion || !socket.connected) return;
  const gamePin = inputPin.value;
  const nickname = inputNick.value.trim();
  if (!new RegExp(`^[0-9]{${configuracion.pinLength}}$`).test(gamePin)) {
    errorMsg.innerText = `El PIN debe contener ${configuracion.pinLength} dígitos.`;
    return;
  }
  const longitud = Array.from(nickname).length;
  if (longitud < configuracion.nicknameMinLength || longitud > configuracion.nicknameMaxLength) {
    errorMsg.innerText = `El nombre debe tener entre ${configuracion.nicknameMinLength} y ${configuracion.nicknameMaxLength} caracteres.`;
    return;
  }
  const version = versionConexion;
  pinSolicitado = gamePin;
  recuperando = true;
  errorMsg.innerText = '';
  mostrarEstado('recuperando', 'Uniéndote a la partida…');
  try {
    const data = await solicitar('unirse_a_partida', { gamePin, nickname });
    if (version !== versionConexion) return;
    sesion = { pin: data.pin, playerId: data.playerId, token: data.token, nickname: data.nickname, pendiente: null };
    guardarSesion();
    miPinActual = data.pin;
    await sincronizarEstado(version);
  } catch (error) {
    if (version !== versionConexion) return;
    recuperando = false;
    errorMsg.innerText = error.message;
    mostrarEstado('espera', error.message);
  }
});

async function enviarPendiente() {
  if (envioEnCurso || !sesionLista || recuperando || !socket.connected || !sesion?.pendiente) return;
  const pendiente = sesion.pendiente;
  const version = versionConexion;
  const envio = { pendiente, version };
  envioEnCurso = envio;
  const vigente = () => version === versionConexion && sesion?.pendiente === pendiente && preguntaIdActual === pendiente.preguntaId;
  try {
    while (vigente() && socket.connected && pendiente.intentos < configuracion.maxRetries + 1) {
      pendiente.intentos++;
      guardarSesion();
      mostrarEstado(pendiente.intentos === 1 ? 'enviando' : 'pendiente', pendiente.intentos === 1
        ? 'Enviando respuesta…' : 'Confirmación pendiente. Reintentando la misma respuesta…');
      try {
        const data = await solicitar('enviar_respuesta', {
          gamePin: miPinActual, preguntaId: pendiente.preguntaId, respuestaSeleccionada: pendiente.respuestaSeleccionada
        });
        if (!vigente()) return;
        sesion.pendiente = null;
        guardarSesion();
        respuestaConfirmada = data;
        mostrarEstado('aceptada', 'Respuesta aceptada. Espera al profesor.');
        return;
      } catch (error) {
        if (!vigente()) return;
        if (!socket.connected) return;
        if (error.code !== 'CONFIRMACION_PENDIENTE') {
          envioEnCurso = null;
          await sincronizarEstado(version, false, error.message);
          return;
        }
      }
    }
    if (vigente() && socket.connected) {
      envioEnCurso = null;
      await sincronizarEstado(version, false);
    }
  } finally {
    if (envioEnCurso === envio) {
      envioEnCurso = null;
      btnConsultar.disabled = !socket.connected || recuperando;
    }
  }
}

function responder(indiceOpcion) {
  if (!socket.connected || !sesionLista || recuperando || estadoJugador !== 'abierta') return;
  sesion.pendiente = { preguntaId: preguntaIdActual, respuestaSeleccionada: indiceOpcion, intentos: 0 };
  guardarSesion();
  enviarPendiente();
}

socket.on('recibir_pregunta', (pregunta) => {
  if (!sesion && !recuperando) return;
  revisionPregunta++;
  preguntaActual = pregunta;
  preguntaIdActual = pregunta.preguntaId;
  preguntaAbierta = true;
  respuestaConfirmada = null;
  envioEnCurso = null;
  if (sesion) { sesion.pendiente = null; guardarSesion(); }
  mostrarEstado('abierta', 'Pregunta abierta. Elige una opción.');
});

socket.on('pregunta_cerrada', ({ preguntaId }) => {
  preguntasCerradas.add(preguntaId);
  revisionPregunta++;
  if (preguntaId !== preguntaIdActual) return;
  preguntaAbierta = false;
  if (!sesion?.pendiente && !respuestaConfirmada) mostrarEstado('cerrada', 'Pregunta cerrada. Espera al profesor.');
});

socket.on('disconnect', () => {
  versionConexion++;
  configuracion = null;
  recuperando = false;
  sesionLista = false;
  envioEnCurso = null;
  if (!sesionReemplazada) mostrarEstado('desconectada', 'Conexión interrumpida. Esperando reconexión…');
  else mostrarEstado('desconectada', estadoConexion.innerText);
});

socket.on('connect_error', () => mostrarEstado('desconectada', 'No se pudo conectar. Esperando reconexión…'));
socket.on('sesion_reemplazada', (data) => {
  sesionReemplazada = true;
  terminarSesion(data.message);
});
socket.on('partida_finalizada', ({ pin, motivo }) => {
  if (pin === (sesion?.pin || pinSolicitado)) terminarSesion(motivo);
});
btnConsultar.addEventListener('click', () => {
  if (envioEnCurso || recuperando || !socket.connected) return;
  recuperarSesion();
});
btnNuevaSesion.addEventListener('click', () => {
  sesionReemplazada = false;
  terminarSesion('');
  inputPin.value = '';
  socket.disconnect();
  socket.connect();
});

mostrarEstado('espera', sesion ? 'Recuperando la sesión…' : '');
