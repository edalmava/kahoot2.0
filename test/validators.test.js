const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG, CLIENT_CONFIG } = require('../src/config');
const { RequestError } = require('../src/errors');
const { validarPartida, validarUnion, validarPregunta, validarRespuesta } = require('../src/validators');

function rechaza(fn, code = 'DATOS_INVALIDOS') {
  assert.throws(fn, (error) => error instanceof RequestError && error.code === code);
}

test('los límites publicados coinciden con la configuración del servidor', () => {
  assert.equal(CONFIG.port, 3000);
  assert.equal(CLIENT_CONFIG.pinLength, 4);
  assert.equal(CLIENT_CONFIG.nicknameMinLength, 1);
  assert.equal(CLIENT_CONFIG.nicknameMaxLength, 32);
  assert.equal(CLIENT_CONFIG.questionDurationMs, 20000);
  assert.equal(CLIENT_CONFIG.ackTimeoutMs, 5000);
  assert.equal(CLIENT_CONFIG.maxRetries, 2);
  assert.equal(CLIENT_CONFIG.optionCount, 4);
  assert.equal(CLIENT_CONFIG.port, undefined);
  assert.ok(Object.isFrozen(CONFIG) && Object.isFrozen(CLIENT_CONFIG));
});

test('todos los validadores rechazan payloads que no sean objetos', () => {
  for (const validate of [validarPartida, validarUnion, validarPregunta, validarRespuesta]) {
    for (const payload of [undefined, null, [], '1234', 1234, true]) {
      rechaza(() => validate(payload));
    }
  }
});

test('el PIN conserva ceros iniciales y rechaza formatos y tipos inválidos', () => {
  assert.deepEqual(validarPartida({ gamePin: '0123' }), { gamePin: '0123' });
  for (const gamePin of [undefined, null, 1234, {}, [], '', '123', '12345', 'abcd', ' 1234', '1234\n', '１２３４']) {
    rechaza(() => validarPartida({ gamePin }));
  }
});

test('el nick se normaliza sin modificar el payload y acepta límites inclusivos', () => {
  const payload = { gamePin: '1234', nickname: '  Ana  ' };
  assert.deepEqual(validarUnion(payload), { gamePin: '1234', nickname: 'Ana' });
  assert.equal(payload.nickname, '  Ana  ');
  for (const nickname of ['A', 'a'.repeat(32)]) {
    assert.equal(validarUnion({ gamePin: '1234', nickname }).nickname, nickname);
  }
});

test('el límite del nick se cuenta por puntos de código Unicode', () => {
  const nickname = '😀'.repeat(32);
  assert.equal(validarUnion({ gamePin: '1234', nickname }).nickname, nickname);
  rechaza(() => validarUnion({ gamePin: '1234', nickname: '😀'.repeat(33) }));
});

test('nicks vacíos, demasiado largos o de otro tipo se rechazan', () => {
  for (const nickname of [undefined, null, 42, [], {}, '', ' \t\n ', 'a'.repeat(33)]) {
    rechaza(() => validarUnion({ gamePin: '1234', nickname }));
  }
});

test('las preguntas exigen un título y cuatro opciones textuales no vacías', () => {
  const pregunta = { titulo: '  Pregunta  ', opciones: [' A ', 'B', 'C', 'D'] };
  assert.deepEqual(validarPregunta({ gamePin: '1234', pregunta }), {
    gamePin: '1234', pregunta: { titulo: 'Pregunta', opciones: ['A', 'B', 'C', 'D'] }
  });
  assert.equal(pregunta.opciones[0], ' A ');
  for (const value of [undefined, null, [], {}, { titulo: ' ', opciones: ['A', 'B', 'C', 'D'] },
    { titulo: 1, opciones: ['A', 'B', 'C', 'D'] }, { titulo: 'P', opciones: ['A'] },
    { titulo: 'P', opciones: ['A', 'B', 'C', 4] }, { titulo: 'P', opciones: ['A', 'B', 'C', ' '] },
    { titulo: 'P', opciones: new Array(4) }]) {
    rechaza(() => validarPregunta({ gamePin: '1234', pregunta: value }));
  }
});

test('una respuesta requiere PIN, ID de pregunta y opción entera sin coerción', () => {
  const payload = { gamePin: '1234', preguntaId: 'pregunta-1', respuestaSeleccionada: 0 };
  assert.deepEqual(validarRespuesta(payload), payload);
  for (const preguntaId of [undefined, null, 1, [], '', ' ']) {
    rechaza(() => validarRespuesta({ ...payload, preguntaId }));
  }
  for (const respuestaSeleccionada of [undefined, null, '0', false, [], {}, 0.5, NaN, Infinity]) {
    rechaza(() => validarRespuesta({ ...payload, respuestaSeleccionada }), 'OPCION_INVALIDA');
  }
});
