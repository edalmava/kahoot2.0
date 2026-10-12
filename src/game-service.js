const { randomUUID, randomBytes } = require('node:crypto');
const { RequestError } = require('./errors');
const { CONFIG } = require('./config');

function createGameService({
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  onQuestionClosed = () => {}
} = {}) {
  const partidasActivas = new Map();
  const sesiones = new Map();
  const conexiones = new Map();

  function obtenerPartida(gamePin) {
    const partida = partidasActivas.get(gamePin);
    if (!partida) {
      throw new RequestError('PARTIDA_NO_EXISTE', 'La partida no existe o ha terminado.');
    }
    return partida;
  }

  function crearPartida(hostSocketId, { gamePin }) {
    if (partidasActivas.has(gamePin)) {
      throw new RequestError('PIN_EN_USO', 'El PIN ya está en uso. Crea otra partida.');
    }
    partidasActivas.set(gamePin, {
      hostSocketId,
      players: new Map(),
      creadaEn: now(),
      estado: 'lobby',
      preguntas: new Map(),
      preguntaActual: null,
      temporizador: null
    });
    return { pin: gamePin };
  }

  function datosPregunta(pregunta) {
    return {
      preguntaId: pregunta.preguntaId,
      titulo: pregunta.titulo,
      opciones: [...pregunta.opciones],
      cierraEn: pregunta.cierraEn
    };
  }

  function datosSesion(sesion) {
    const partida = obtenerPartida(sesion.gamePin);
    comprobarVigencia(partida);
    const jugador = partida.players.get(sesion.playerId);
    return {
      ...datosEstado(sesion),
      playerId: jugador.id,
      token: sesion.token,
      nickname: jugador.nickname
    };
  }

  function datosEstado(sesion) {
    const partida = obtenerPartida(sesion.gamePin);
    comprobarVigencia(partida);
    const pregunta = partida.preguntaActual;
    const ahora = now();
    const respuesta = pregunta?.respuestas.get(sesion.playerId);
    return {
      pin: sesion.gamePin,
      estado: partida.estado,
      pregunta: pregunta ? datosPregunta(pregunta) : null,
      preguntaAbierta: Boolean(pregunta?.abierta && ahora >= pregunta.abiertaEn && ahora < pregunta.cierraEn),
      respuesta: respuesta ? { ...respuesta } : null
    };
  }

  function consultarEstado(socketId, identidad, { gamePin }) {
    return datosEstado(verificarPertenencia(socketId, identidad, gamePin));
  }

  function unirseAPartida(socketId, { gamePin, nickname }) {
    const existente = conexiones.get(socketId);
    if (existente) {
      if (existente.socketId !== socketId || existente.gamePin !== gamePin) {
        throw new RequestError('SESION_INVALIDA', 'Inicia otra sesión para cambiar de partida.');
      }
      return { data: datosSesion(existente), nuevo: false };
    }
    const partida = obtenerPartida(gamePin);
    comprobarVigencia(partida);
    const playerId = randomUUID();
    const token = randomBytes(32).toString('hex');
    const jugador = { id: playerId, nickname, puntos: 0 };
    const sesion = { gamePin, playerId, token, socketId };
    partida.players.set(playerId, jugador);
    sesiones.set(token, sesion);
    conexiones.set(socketId, sesion);
    return { data: datosSesion(sesion), jugador: { ...jugador }, nuevo: true };
  }

  function reanudarSesion(socketId, { gamePin, token }) {
    const sesion = sesiones.get(token);
    const partida = partidasActivas.get(gamePin);
    if (!sesion || sesion.gamePin !== gamePin || !partida?.players.has(sesion.playerId) || partida.estado === 'finalizada') {
      throw new RequestError('SESION_INVALIDA', 'La sesión no existe o ya no es válida.');
    }
    const existente = conexiones.get(socketId);
    if (existente && (existente !== sesion || existente.socketId !== socketId)) {
      throw new RequestError('SESION_INVALIDA', 'La conexión ya pertenece a otra sesión.');
    }
    const socketAnterior = sesion.socketId === socketId ? null : sesion.socketId;
    sesion.socketId = socketId;
    conexiones.set(socketId, sesion);
    return { data: datosSesion(sesion), socketAnterior };
  }

  function desconectar(socketId) {
    const sesion = conexiones.get(socketId);
    if (sesion?.socketId === socketId) sesion.socketId = null;
    conexiones.delete(socketId);
  }

  function verificarPertenencia(socketId, identidad, gamePin) {
    const partida = obtenerPartida(gamePin);
    const sesion = conexiones.get(socketId);
    if (!sesion || sesion.gamePin !== gamePin || identidad.gamePin !== gamePin || identidad.playerId !== sesion.playerId) {
      throw new RequestError('NO_PERTENECE', 'El jugador no pertenece a esta partida.');
    }
    if (sesion.socketId !== socketId || sesiones.get(sesion.token) !== sesion) {
      throw new RequestError('SESION_INVALIDA', 'Esta conexión ya no tiene una sesión activa.');
    }
    if (!partida.players.has(sesion.playerId)) {
      throw new RequestError('NO_PERTENECE', 'El jugador no pertenece a esta partida.');
    }
    return sesion;
  }

  function comprobarVigencia(partida) {
    if (partida.estado === 'finalizada') {
      throw new RequestError('PARTIDA_NO_EXISTE', 'La partida no existe o ha terminado.');
    }
  }

  function autorizarProfesor(hostSocketId, gamePin) {
    const partida = obtenerPartida(gamePin);
    if (partida.hostSocketId !== hostSocketId) {
      throw new RequestError('NO_AUTORIZADO', 'Solo el profesor propietario puede controlar esta partida.');
    }
    return partida;
  }

  function iniciarJuego(hostSocketId, { gamePin }) {
    const partida = autorizarProfesor(hostSocketId, gamePin);
    comprobarVigencia(partida);
    partida.estado = 'en_curso';
    return { pin: gamePin };
  }

  function cancelarTemporizador(partida) {
    if (partida.temporizador !== null) clearTimer(partida.temporizador);
    partida.temporizador = null;
  }

  function cerrarPregunta(gamePin, preguntaId) {
    const partida = partidasActivas.get(gamePin);
    const pregunta = partida?.preguntaActual;
    if (partida?.estado !== 'en_curso' || pregunta?.preguntaId !== preguntaId || !pregunta.abierta) return;
    if (now() < pregunta.cierraEn) {
      programarCierre(gamePin, partida, pregunta);
      return;
    }
    cancelarTemporizador(partida);
    pregunta.abierta = false;
    onQuestionClosed(gamePin, { preguntaId });
  }

  function programarCierre(gamePin, partida, pregunta) {
    cancelarTemporizador(partida);
    partida.temporizador = setTimer(() => cerrarPregunta(gamePin, pregunta.preguntaId), Math.max(0, pregunta.cierraEn - now()));
    partida.temporizador?.unref?.();
  }

  function enviarPregunta(hostSocketId, { gamePin, pregunta }) {
    const partida = autorizarProfesor(hostSocketId, gamePin);
    comprobarVigencia(partida);
    if (partida.estado !== 'en_curso') {
      throw new RequestError('JUEGO_NO_INICIADO', 'Inicia el juego antes de publicar una pregunta.');
    }
    const abiertaEn = now();
    const nueva = {
      preguntaId: randomUUID(),
      titulo: pregunta.titulo,
      opciones: [...pregunta.opciones],
      abiertaEn,
      cierraEn: abiertaEn + CONFIG.questionDurationMs,
      abierta: true,
      respuestas: new Map()
    };
    cancelarTemporizador(partida);
    if (partida.preguntaActual) partida.preguntaActual.abierta = false;
    partida.preguntas.set(nueva.preguntaId, nueva);
    partida.preguntaActual = nueva;
    programarCierre(gamePin, partida, nueva);
    return datosPregunta(nueva);
  }

  function enviarRespuesta(socketId, identidad, { gamePin, preguntaId, respuestaSeleccionada }) {
    const sesion = verificarPertenencia(socketId, identidad, gamePin);
    const partida = obtenerPartida(gamePin);
    comprobarVigencia(partida);
    if (partida.estado !== 'en_curso' || !partida.preguntaActual) {
      throw new RequestError('SIN_PREGUNTA_ACTIVA', 'No hay una pregunta activa.');
    }
    const pregunta = partida.preguntas.get(preguntaId);
    if (!pregunta) {
      throw new RequestError('PREGUNTA_INCORRECTA', 'La respuesta no corresponde a una pregunta de esta partida.');
    }
    if (!Number.isInteger(respuestaSeleccionada) || respuestaSeleccionada < 0 || respuestaSeleccionada >= pregunta.opciones.length) {
      throw new RequestError('OPCION_INVALIDA', 'La opción debe ser un índice entero dentro de las opciones de la pregunta.');
    }
    const previa = pregunta.respuestas.get(sesion.playerId);
    if (previa) {
      if (previa.respuestaSeleccionada !== respuestaSeleccionada) {
        throw new RequestError('YA_RESPONDIO', 'Ya respondiste esta pregunta y no puedes cambiar la opción.');
      }
      return { data: { ...previa }, nuevo: false, totalAceptado: pregunta.respuestas.size };
    }
    if (partida.preguntaActual.preguntaId !== preguntaId) {
      throw new RequestError('PREGUNTA_INCORRECTA', 'La respuesta no corresponde a la pregunta activa.');
    }
    const ahora = now();
    if (!pregunta.abierta || ahora < pregunta.abiertaEn || ahora >= pregunta.cierraEn) {
      throw new RequestError('PLAZO_CERRADO', 'El plazo para responder está cerrado.');
    }
    // Comprobar y registrar sin await evita intercalar dos respuestas del mismo jugador.
    const data = { playerId: sesion.playerId, preguntaId, respuestaSeleccionada };
    pregunta.respuestas.set(sesion.playerId, { ...data });
    return { data, nuevo: true, totalAceptado: pregunta.respuestas.size };
  }

  function finalizarPartida(hostSocketId, { gamePin }) {
    const partida = autorizarProfesor(hostSocketId, gamePin);
    cancelarTemporizador(partida);
    if (partida.preguntaActual) partida.preguntaActual.abierta = false;
    partida.estado = 'finalizada';
    for (const [token, sesion] of sesiones) {
      if (sesion.gamePin === gamePin) sesiones.delete(token);
    }
    for (const [socketId, sesion] of conexiones) {
      if (sesion.gamePin === gamePin) conexiones.delete(socketId);
    }
    for (const pregunta of partida.preguntas.values()) pregunta.respuestas.clear();
    partida.preguntas.clear();
    partida.players.clear();
    partida.preguntaActual = null;
    partidasActivas.delete(gamePin);
    return { pin: gamePin };
  }

  function desconectarProfesor(hostSocketId) {
    const finalizadas = [];
    for (const [gamePin, partida] of partidasActivas) {
      if (partida.hostSocketId === hostSocketId) finalizadas.push(finalizarPartida(hostSocketId, { gamePin }));
    }
    return finalizadas;
  }

  function cerrar() {
    for (const [gamePin, partida] of partidasActivas) {
      finalizarPartida(partida.hostSocketId, { gamePin });
    }
    partidasActivas.clear();
    sesiones.clear();
    conexiones.clear();
  }

  return {
    crearPartida, obtenerPartida, unirseAPartida, reanudarSesion, desconectar,
    iniciarJuego, enviarPregunta, enviarRespuesta, consultarEstado, finalizarPartida, desconectarProfesor, cerrar
  };
}

module.exports = { createGameService };
