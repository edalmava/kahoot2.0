const { randomUUID } = require('node:crypto');
const { RequestError } = require('./errors');

function createGameService({ now = Date.now } = {}) {
  const partidasActivas = new Map();

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
      players: [],
      creadaEn: now(),
      preguntaActual: null
    });
    return { pin: gamePin };
  }

  function unirseAPartida(playerId, { gamePin, nickname }) {
    const partida = obtenerPartida(gamePin);
    const jugador = { id: playerId, nickname, puntos: 0 };
    partida.players.push(jugador);
    return { pin: gamePin, jugador };
  }

  function iniciarJuego({ gamePin }) {
    obtenerPartida(gamePin);
    return { pin: gamePin };
  }

  function enviarPregunta({ gamePin, pregunta }) {
    const partida = obtenerPartida(gamePin);
    partida.preguntaActual = {
      preguntaId: randomUUID(),
      titulo: pregunta.titulo,
      opciones: [...pregunta.opciones],
      publicadaEn: now()
    };
    return { ...partida.preguntaActual, opciones: [...partida.preguntaActual.opciones] };
  }

  function enviarRespuesta(playerId, { gamePin, preguntaId, respuestaSeleccionada }) {
    obtenerPartida(gamePin);
    // Las reglas de sesión, plazo y respuesta única se incorporan en fases 2–4.
    return { playerId, preguntaId, respuestaSeleccionada };
  }

  function cerrar() {
    partidasActivas.clear();
  }

  return { crearPartida, obtenerPartida, unirseAPartida, iniciarJuego, enviarPregunta, enviarRespuesta, cerrar };
}

module.exports = { createGameService };
