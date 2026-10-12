const { CONFIG } = require('./config');
const { RequestError } = require('./errors');

const PIN_PATTERN = new RegExp(`^[0-9]{${CONFIG.pinLength}}$`);

function validarObjeto(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestError('DATOS_INVALIDOS', 'Se esperaba un objeto de datos.');
  }
}

function validarPin(gamePin) {
  if (typeof gamePin !== 'string' || !PIN_PATTERN.test(gamePin)) {
    throw new RequestError('DATOS_INVALIDOS', `El PIN debe contener ${CONFIG.pinLength} dígitos.`);
  }
  return gamePin;
}

function validarPartida(payload) {
  validarObjeto(payload);
  return { gamePin: validarPin(payload.gamePin) };
}

function validarUnion(payload) {
  const { gamePin } = validarPartida(payload);
  if (typeof payload.nickname !== 'string') {
    throw new RequestError('DATOS_INVALIDOS', 'El nombre debe ser una cadena de texto.');
  }
  const nickname = payload.nickname.trim();
  const longitud = Array.from(nickname).length;
  if (longitud < CONFIG.nicknameMinLength || longitud > CONFIG.nicknameMaxLength) {
    throw new RequestError('DATOS_INVALIDOS', `El nombre debe tener entre ${CONFIG.nicknameMinLength} y ${CONFIG.nicknameMaxLength} caracteres.`);
  }
  return { gamePin, nickname };
}

function validarPregunta(payload) {
  const { gamePin } = validarPartida(payload);
  validarObjeto(payload.pregunta);
  const { titulo, opciones } = payload.pregunta;
  if (typeof titulo !== 'string' || !titulo.trim()) {
    throw new RequestError('DATOS_INVALIDOS', 'La pregunta debe tener un título.');
  }
  if (!Array.isArray(opciones) || opciones.length !== CONFIG.optionCount) {
    throw new RequestError('DATOS_INVALIDOS', `La pregunta debe tener ${CONFIG.optionCount} opciones.`);
  }
  const opcionesLimpias = [];
  for (const opcion of opciones) {
    if (typeof opcion !== 'string' || !opcion.trim()) {
      throw new RequestError('DATOS_INVALIDOS', 'Las opciones deben ser textos no vacíos.');
    }
    opcionesLimpias.push(opcion.trim());
  }
  return { gamePin, pregunta: { titulo: titulo.trim(), opciones: opcionesLimpias } };
}

function validarRespuesta(payload) {
  const { gamePin } = validarPartida(payload);
  if (typeof payload.preguntaId !== 'string' || !payload.preguntaId.trim()) {
    throw new RequestError('DATOS_INVALIDOS', 'La respuesta debe identificar la pregunta.');
  }
  if (!Number.isInteger(payload.respuestaSeleccionada)) {
    throw new RequestError('OPCION_INVALIDA', 'La opción debe ser un número entero.');
  }
  return {
    gamePin,
    preguntaId: payload.preguntaId,
    respuestaSeleccionada: payload.respuestaSeleccionada
  };
}

module.exports = { validarPartida, validarUnion, validarPregunta, validarRespuesta };
