const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerRequest } = require('../src/request-handler');
const { validarPartida } = require('../src/validators');
const { RequestError } = require('../src/errors');

function preparar(handle, logger = { error() {} }) {
  const socket = new EventEmitter();
  registerRequest(socket, 'solicitud', validarPartida, handle, logger);
  return socket.listeners('solicitud')[0];
}

test('sin callback o con callback de otro tipo no se ejecuta la operación', async () => {
  let ejecuciones = 0;
  const handler = preparar(() => { ejecuciones++; });
  for (const callback of [undefined, null, true, {}, 'callback']) {
    await handler({ gamePin: '1234' }, callback);
  }
  await handler({ gamePin: '1234' });
  assert.equal(ejecuciones, 0);
});

test('los argumentos inválidos se rechazan una sola vez y no ejecutan la operación', async () => {
  let ejecuciones = 0;
  const handler = preparar(() => { ejecuciones++; });
  for (const args of [[], [null], [[]], [{}], [{ gamePin: 1234 }], [{ gamePin: '1234' }, 'extra']]) {
    const respuestas = [];
    await handler(...args, (response) => respuestas.push(response));
    assert.equal(respuestas.length, 1);
    assert.equal(respuestas[0].ok, false);
    assert.equal(respuestas[0].error.code, 'DATOS_INVALIDOS');
  }
  assert.equal(ejecuciones, 0);
});

test('una solicitud válida recibe una confirmación estructurada', async () => {
  const respuestas = [];
  const handler = preparar(async ({ gamePin }) => ({ pin: gamePin }));
  await handler({ gamePin: '1234' }, (response) => respuestas.push(response));
  assert.deepEqual(respuestas, [{ ok: true, data: { pin: '1234' } }]);
});

test('errores síncronos y rechazos asíncronos no exponen detalles internos', async () => {
  const detallePrivado = 'token=secreto; datos internos';
  for (const handle of [() => { throw new Error(detallePrivado); }, async () => { throw new Error(detallePrivado); }]) {
    const respuestas = [];
    const logs = [];
    const handler = preparar(handle, { error: (message) => logs.push(message) });
    await handler({ gamePin: '1234' }, (response) => respuestas.push(response));
    assert.deepEqual(respuestas, [{
      ok: false, error: { code: 'ERROR_INTERNO', message: 'No se pudo procesar la solicitud.' }
    }]);
    assert.equal(logs.length, 1);
    assert.equal(JSON.stringify({ respuestas, logs }).includes(detallePrivado), false);
  }
});

test('cada código de rechazo de respuestas conserva su contrato y produce un solo acuse', async () => {
  for (const code of [
    'DATOS_INVALIDOS', 'PARTIDA_NO_EXISTE', 'NO_PERTENECE', 'SESION_INVALIDA',
    'SIN_PREGUNTA_ACTIVA', 'PREGUNTA_INCORRECTA', 'PLAZO_CERRADO', 'OPCION_INVALIDA', 'YA_RESPONDIO'
  ]) {
    const respuestas = [];
    const handler = preparar(() => { throw new RequestError(code, 'Solicitud rechazada.'); });
    await handler({ gamePin: '1234' }, (response) => respuestas.push(response));
    assert.deepEqual(respuestas, [{ ok: false, error: { code, message: 'Solicitud rechazada.' } }]);
  }
});
