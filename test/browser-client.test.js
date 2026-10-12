const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CLIENT_CONFIG } = require('../src/config');
const { createBrowserClient, flushClient } = require('../test-support/browser-client');

const sesion = { pin: '0123', playerId: 'ana', token: 'ab'.repeat(32), nickname: 'Ana', pendiente: null };
const pregunta = { preguntaId: 'p1', titulo: 'P', opciones: ['A', 'B', 'C', 'D'], cierraEn: 21000 };
const estado = { pin: '0123', estado: 'en_curso', pregunta, preguntaAbierta: true, respuesta: null };
const aceptada = { playerId: 'ana', preguntaId: 'p1', respuestaSeleccionada: 1 };

async function recuperar(client, snapshot = estado) {
  client.socket.emit('configuracion', CLIENT_CONFIG);
  client.accept('reanudar_sesion', { ...sesion, ...snapshot });
  await flushClient();
  client.accept('consultar_estado', snapshot);
  await flushClient();
}

async function jugador() {
  const client = createBrowserClient('player.js', sesion);
  await recuperar(client);
  return client;
}

test('el formulario conserva ceros del PIN y valida nick por puntos de código Unicode', async () => {
  const client = createBrowserClient('player.js');
  client.socket.emit('configuracion', CLIENT_CONFIG);
  client.element('input-pin').value = '123';
  client.element('input-nick').value = 'Ana';
  client.element('btn-unirse').click();
  assert.equal(client.requests.length, 0);
  assert.match(client.element('error-msg').innerText, /4 dígitos/);
  client.element('input-pin').value = '0123';
  for (const nickname of [' ', '😀'.repeat(33)]) {
    client.element('input-nick').value = nickname;
    client.element('btn-unirse').click();
    assert.equal(client.requests.length, 0);
  }
  client.element('input-nick').value = ` ${'😀'.repeat(32)} `;
  client.element('btn-unirse').click();
  const union = client.next('unirse_a_partida');
  assert.equal(union.payload.gamePin, '0123');
  assert.equal(union.payload.nickname, '😀'.repeat(32));
  union.resolve({ ok: true, data: { ...sesion, nickname: union.payload.nickname } });
  await flushClient();
  assert.ok(client.options.every((button) => button.disabled));
  client.accept('consultar_estado', estado);
  await flushClient();
  assert.equal(client.evaluate('miPinActual'), '0123');
  assert.ok(client.options.every((button) => !button.disabled));
});

test('el doble clic emite una sola respuesta y solo el acuse positivo muestra aceptación', async () => {
  const client = await jugador();
  client.evaluate('responder(1); responder(2);');
  assert.equal(client.requests.filter(({ event }) => event === 'enviar_respuesta').length, 1);
  assert.equal(client.evaluate('estadoJugador'), 'enviando');
  assert.ok(client.options.every((button) => button.disabled));
  assert.doesNotMatch(client.element('estado-conexion').innerText, /aceptada/);
  client.accept('enviar_respuesta', aceptada);
  await flushClient();
  assert.equal(client.evaluate('estadoJugador'), 'aceptada');
  assert.match(client.element('estado-conexion').innerText, /Respuesta aceptada/);
  assert.ok(client.options.every((button) => button.disabled));
});

test('los timeouts reintentan la misma opción hasta el límite y luego consultan el registro', async () => {
  const client = await jugador();
  client.evaluate('responder(1)');
  for (let i = 0; i < CLIENT_CONFIG.maxRetries + 1; i++) {
    client.timeout('enviar_respuesta');
    await flushClient();
    assert.ok(client.options.every((button) => button.disabled));
    if (i < CLIENT_CONFIG.maxRetries) {
      assert.equal(client.evaluate('estadoJugador'), 'pendiente');
      assert.match(client.element('estado-conexion').innerText, /Confirmación pendiente/);
      client.evaluate('responder(2)');
    }
  }
  const envios = client.requests.filter(({ event }) => event === 'enviar_respuesta');
  assert.equal(envios.length, 3);
  assert.ok(envios.every(({ payload }) => payload.preguntaId === 'p1' && payload.respuestaSeleccionada === 1));
  assert.equal(JSON.parse(client.storage.get('kahoot.playerSession')).pendiente.intentos, 3);
  client.accept('consultar_estado', { ...estado, respuesta: aceptada });
  await flushClient();
  assert.equal(client.evaluate('estadoJugador'), 'aceptada');
  assert.equal(JSON.parse(client.storage.get('kahoot.playerSession')).pendiente, null);
});

test('un rechazo solo habilita otra opción después de consultar un estado abierto sin respuesta', async () => {
  const client = await jugador();
  client.evaluate('responder(4)');
  client.reject('enviar_respuesta', 'OPCION_INVALIDA', 'Opción inválida.');
  await flushClient();
  assert.ok(client.options.every((button) => button.disabled));
  client.accept('consultar_estado', estado);
  await flushClient();
  assert.equal(client.evaluate('estadoJugador'), 'abierta');
  assert.match(client.element('estado-conexion').innerText, /Opción inválida/);
  client.evaluate('responder(0)');
  assert.equal(client.next('enviar_respuesta').payload.respuestaSeleccionada, 0);
});

test('rechazar un cambio de opción muestra el motivo y recupera la aceptación anterior sin habilitar botones', async () => {
  const client = await jugador();
  client.evaluate('responder(2)');
  client.reject('enviar_respuesta', 'YA_RESPONDIO', 'Ya respondiste esta pregunta.');
  await flushClient();
  assert.match(client.element('estado-conexion').innerText, /Ya respondiste/);
  client.accept('consultar_estado', { ...estado, respuesta: aceptada });
  await flushClient();
  assert.equal(client.evaluate('estadoJugador'), 'aceptada');
  assert.match(client.element('estado-conexion').innerText, /Ya respondiste/);
  assert.equal(client.evaluate('respuestaConfirmada.respuestaSeleccionada'), 1);
  assert.ok(client.options.every((button) => button.disabled));
});

test('si falla la consulta tras agotar reintentos permanece pendiente hasta reconciliar', async () => {
  const client = await jugador();
  client.evaluate('responder(1)');
  for (let i = 0; i < 3; i++) { client.timeout('enviar_respuesta'); await flushClient(); }
  client.timeout('consultar_estado');
  await flushClient();
  assert.equal(client.evaluate('estadoJugador'), 'pendiente');
  assert.ok(client.options.every((button) => button.disabled));
  assert.equal(client.element('btn-consultar').disabled, false);
  client.element('btn-consultar').click();
  client.accept('reanudar_sesion', { ...sesion, ...estado });
  await flushClient();
  client.accept('consultar_estado', estado);
  await flushClient();
  assert.equal(client.requests.filter(({ event }) => event === 'enviar_respuesta').length, 3);
  assert.equal(client.evaluate('estadoJugador'), 'abierta');
});

test('un acuse antiguo no acepta ni bloquea una pregunta nueva', async () => {
  const client = await jugador();
  client.evaluate('responder(1)');
  const anterior = client.next('enviar_respuesta');
  client.socket.emit('recibir_pregunta', { ...pregunta, preguntaId: 'p2' });
  anterior.resolve({ ok: true, data: aceptada });
  await flushClient();
  assert.equal(client.evaluate('preguntaIdActual'), 'p2');
  assert.equal(client.evaluate('estadoJugador'), 'abierta');
  client.evaluate('responder(3)');
  assert.equal(client.next('enviar_respuesta').payload.preguntaId, 'p2');
});

test('reconectar consulta antes de reintentar y un acuse de la conexión anterior se ignora', async () => {
  const client = await jugador();
  client.evaluate('responder(1)');
  const anterior = client.next('enviar_respuesta');
  client.socket.disconnect();
  const numero = client.requests.length;
  client.evaluate('responder(2)');
  assert.equal(client.requests.length, numero);
  anterior.resolve({ ok: true, data: aceptada });
  await flushClient();
  assert.equal(client.evaluate('estadoJugador'), 'desconectada');
  client.socket.connect();
  await recuperar(client, { ...estado, respuesta: aceptada });
  assert.equal(client.evaluate('estadoJugador'), 'aceptada');
  assert.equal(client.requests.filter(({ event }) => event === 'enviar_respuesta').length, 1);
});

test('recargar conserva la solicitud pendiente y reintenta solo tras confirmar que no está registrada', async () => {
  const client = createBrowserClient('player.js', { ...sesion, pendiente: { preguntaId: 'p1', respuestaSeleccionada: 2, intentos: 1 } });
  await recuperar(client);
  const reintento = client.next('enviar_respuesta');
  assert.equal(reintento.payload.respuestaSeleccionada, 2);
  assert.equal(JSON.parse(client.storage.get('kahoot.playerSession')).pendiente.intentos, 2);
  reintento.resolve({ ok: true, data: { ...aceptada, respuestaSeleccionada: 2 } });
  await flushClient();
  assert.equal(client.evaluate('estadoJugador'), 'aceptada');
});

test('un cierre durante un envío permite confirmar la aceptación previa y bloquea nuevas respuestas', async () => {
  const client = await jugador();
  client.evaluate('responder(1)');
  client.socket.emit('pregunta_cerrada', { preguntaId: 'p1' });
  client.timeout('enviar_respuesta');
  await flushClient();
  client.accept('enviar_respuesta', aceptada);
  await flushClient();
  assert.equal(client.evaluate('estadoJugador'), 'aceptada');
  assert.ok(client.options.every((button) => button.disabled));
});

test('eventos durante la recuperación fuerzan otra consulta y no habilitan desde un snapshot antiguo', async () => {
  const client = createBrowserClient('player.js', sesion);
  client.socket.emit('configuracion', CLIENT_CONFIG);
  client.accept('reanudar_sesion', { ...sesion, ...estado });
  await flushClient();
  const consulta = client.next('consultar_estado');
  client.socket.emit('recibir_pregunta', { ...pregunta, preguntaId: 'p2' });
  client.socket.emit('pregunta_cerrada', { preguntaId: 'p2' });
  consulta.resolve({ ok: true, data: estado });
  await flushClient();
  assert.ok(client.options.every((button) => button.disabled));
  client.accept('consultar_estado', { ...estado, pregunta: { ...pregunta, preguntaId: 'p2' }, preguntaAbierta: false });
  await flushClient();
  assert.equal(client.evaluate('preguntaIdActual'), 'p2');
  assert.equal(client.evaluate('estadoJugador'), 'cerrada');
});

test('finalizar durante un envío invalida su acuse, limpia credenciales y vuelve al formulario', async () => {
  const client = await jugador();
  client.evaluate('responder(1)');
  const envio = client.next('enviar_respuesta');
  client.socket.emit('partida_finalizada', { pin: '0123', motivo: 'El profesor se desconectó.' });
  envio.resolve({ ok: true, data: aceptada });
  await flushClient();
  assert.equal(client.storage.has('kahoot.playerSession'), false);
  assert.equal(client.element('pantalla-login').style.display, 'block');
  assert.match(client.element('estado-conexion').innerText, /profesor se desconectó/);
  assert.ok(client.options.every((button) => button.disabled));
});

test('una sesión perdida tras reiniciar vuelve al formulario y los listeners no se duplican', async () => {
  const client = await jugador();
  const listeners = client.socket.listenerCount('recibir_pregunta');
  client.socket.disconnect();
  client.socket.connect();
  client.socket.emit('configuracion', CLIENT_CONFIG);
  client.reject('reanudar_sesion', 'SESION_INVALIDA', 'La sesión ya no existe.');
  await flushClient();
  assert.equal(client.element('pantalla-login').style.display, 'block');
  assert.equal(client.storage.has('kahoot.playerSession'), false);
  assert.equal(client.socket.listenerCount('recibir_pregunta'), listeners);
});

test('el profesor usa el total confirmado, filtra otra pregunta y no reinicia el contador al llegar el acuse', async () => {
  const client = createBrowserClient('host.js');
  client.socket.emit('configuracion', CLIENT_CONFIG);
  client.element('btn-crear').click();
  client.accept('crear_partida', { pin: '0123' });
  await flushClient();
  client.element('btn-comenzar').click();
  client.accept('iniciar_juego', { pin: '0123' });
  await flushClient();
  client.socket.emit('recibir_pregunta', pregunta);
  client.socket.emit('respuesta_recibida', { preguntaId: 'p1', totalAceptado: 3 });
  client.accept('enviar_pregunta', pregunta);
  await flushClient();
  assert.equal(client.element('respuestas-conteo').innerText, '3');
  client.socket.emit('respuesta_recibida', { preguntaId: 'p1', totalAceptado: 3 });
  client.socket.emit('respuesta_recibida', { preguntaId: 'otra', totalAceptado: 20 });
  assert.equal(client.element('respuestas-conteo').innerText, '3');
  client.socket.emit('recibir_pregunta', { ...pregunta, preguntaId: 'p2' });
  assert.equal(client.element('respuestas-conteo').innerText, '0');
  client.socket.emit('respuesta_recibida', { preguntaId: 'p1', totalAceptado: 4 });
  client.socket.emit('pregunta_cerrada', { preguntaId: 'p1' });
  assert.equal(client.element('respuestas-conteo').innerText, '0');
  assert.match(client.element('estado-pregunta').innerText, /abierta/);
  client.socket.disconnect();
  assert.equal(client.element('pantalla-inicio').style.display, 'block');
  assert.equal(client.element('btn-comenzar').disabled, true);
});
