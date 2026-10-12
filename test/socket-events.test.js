const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const { createGameServer } = require('../server');
const { CLIENT_CONFIG } = require('../src/config');

// Mismo cliente distribuido a los navegadores por /socket.io/socket.io.js.
// En Node.js 24 usa WebSocket nativo y no necesita descargas adicionales.
const { io: connect } = require(path.join(
  path.dirname(require.resolve('socket.io/package.json')), 'client-dist/socket.io.js'
));

function esperar(socket, evento) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(evento, recibir);
      reject(new Error(`No se recibió ${evento}.`));
    }, 2000);
    function recibir(data) {
      clearTimeout(timeout);
      resolve(data);
    }
    socket.once(evento, recibir);
  });
}

async function preparar(t, options) {
  const server = createGameServer(options);
  const clientes = [];
  t.after(async () => {
    clientes.forEach((socket) => socket.disconnect());
    await server.close();
  });
  const escuchando = once(server.httpServer, 'listening');
  server.httpServer.listen(0, '127.0.0.1');
  await escuchando;
  const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;

  async function conectar(namespace) {
    const socket = connect(`${baseUrl}${namespace}`, {
      autoConnect: false, transports: ['websocket'], reconnection: false, forceNew: true
    });
    clientes.push(socket);
    const configuracion = esperar(socket, 'configuracion');
    const conectado = new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    socket.connect();
    await conectado;
    assert.deepEqual(await configuracion, CLIENT_CONFIG);
    return socket;
  }

  return { server, baseUrl, conectar };
}

function solicitar(socket, evento, payload) {
  return socket.timeout(2000).emitWithAck(evento, payload);
}

test('se conservan rutas, scripts y cliente de Socket.IO', { timeout: 10000 }, async (t) => {
  const { baseUrl } = await preparar(t);
  for (const [ruta, contenido] of [
    ['/host-panel', 'Panel del Profesor'], ['/play', 'input-pin'],
    ['/js/host.js', 'crear_partida'], ['/js/player.js', 'preguntaId'],
    ['/css/style.css', '.btn-opcion'], ['/socket.io/socket.io.js', 'Socket.IO']
  ]) {
    const response = await fetch(`${baseUrl}${ruta}`);
    assert.equal(response.status, 200, ruta);
    assert.ok((await response.text()).includes(contenido), ruta);
  }
});

test('profesor y jugador completan el flujo con confirmaciones e ID de pregunta', { timeout: 10000 }, async (t) => {
  const { conectar } = await preparar(t, { now: () => 12345 });
  const host = await conectar('/host');
  const player = await conectar('/player');
  assert.deepEqual(await solicitar(host, 'crear_partida', { gamePin: '1234' }), {
    ok: true, data: { pin: '1234' }
  });
  const nuevoJugador = esperar(host, 'nuevo_jugador');
  assert.deepEqual(await solicitar(player, 'unirse_a_partida', { gamePin: '1234', nickname: ' Ana ' }), {
    ok: true, data: { pin: '1234' }
  });
  assert.deepEqual(await nuevoJugador, { id: player.id, nickname: 'Ana', puntos: 0 });
  const inicio = esperar(player, 'juego_iniciado');
  assert.equal((await solicitar(host, 'iniciar_juego', { gamePin: '1234' })).ok, true);
  assert.deepEqual(await inicio, { pin: '1234' });
  const recibida = esperar(player, 'recibir_pregunta');
  const publicada = await solicitar(host, 'enviar_pregunta', {
    gamePin: '1234', pregunta: { titulo: 'Pregunta', opciones: ['A', 'B', 'C', 'D'] }
  });
  assert.equal(publicada.ok, true);
  assert.ok(publicada.data.preguntaId);
  assert.equal(publicada.data.publicadaEn, 12345);
  assert.deepEqual(await recibida, publicada.data);
  const notificacion = esperar(host, 'respuesta_recibida');
  const respuesta = await solicitar(player, 'enviar_respuesta', {
    gamePin: '1234', preguntaId: publicada.data.preguntaId, respuestaSeleccionada: 1
  });
  assert.deepEqual(respuesta, { ok: true, data: {
    playerId: player.id, preguntaId: publicada.data.preguntaId, respuestaSeleccionada: 1
  } });
  assert.deepEqual(await notificacion, {
    playerId: player.id, preguntaId: publicada.data.preguntaId, respuesta: 1
  });
});

test('payloads malformados no crean partidas, jugadores ni preguntas', { timeout: 10000 }, async (t) => {
  const { server, conectar } = await preparar(t);
  const host = await conectar('/host');
  const player = await conectar('/player');
  for (const payload of [undefined, null, [], {}, { gamePin: 1234 }, { gamePin: '12a4' }]) {
    const response = await solicitar(host, 'crear_partida', payload);
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'DATOS_INVALIDOS');
  }
  assert.throws(() => server.gameService.obtenerPartida('1234'), { code: 'PARTIDA_NO_EXISTE' });
  await solicitar(host, 'crear_partida', { gamePin: '1234' });
  for (const nickname of [null, [], {}, 123, ' ', 'a'.repeat(33)]) {
    assert.equal((await solicitar(player, 'unirse_a_partida', { gamePin: '1234', nickname })).ok, false);
  }
  assert.equal(server.gameService.obtenerPartida('1234').players.length, 0);
  for (const pregunta of [null, [], {}, { titulo: 'P', opciones: ['A'] }]) {
    assert.equal((await solicitar(host, 'enviar_pregunta', { gamePin: '1234', pregunta })).ok, false);
  }
  assert.equal(server.gameService.obtenerPartida('1234').preguntaActual, null);
  assert.equal((await solicitar(host, 'iniciar_juego', { gamePin: '1234' })).ok, true);
});

test('solicitudes sin acuse o sin payload no mutan el estado', { timeout: 10000 }, async (t) => {
  const { server, conectar } = await preparar(t);
  const host = await conectar('/host');
  const player = await conectar('/player');
  host.emit('crear_partida', { gamePin: '1234' });
  // El acuse posterior sirve como barrera para los eventos ordenados del socket.
  await solicitar(host, 'crear_partida', { gamePin: '5678' });
  assert.throws(() => server.gameService.obtenerPartida('1234'), { code: 'PARTIDA_NO_EXISTE' });
  player.emit('unirse_a_partida', { gamePin: '5678', nickname: 'Ana' });
  const barrier = await solicitar(player, 'unirse_a_partida', { gamePin: '0000', nickname: 'Ana' });
  assert.equal(barrier.error.code, 'PARTIDA_NO_EXISTE');
  assert.equal(server.gameService.obtenerPartida('5678').players.length, 0);
  const sinPayload = await host.timeout(2000).emitWithAck('crear_partida');
  assert.equal(sinPayload.error.code, 'DATOS_INVALIDOS');
  const extras = await host.timeout(2000).emitWithAck('crear_partida', { gamePin: '1234' }, 'extra');
  assert.equal(extras.error.code, 'DATOS_INVALIDOS');
});

test('el rechazo por PIN desconocido se comunica mediante confirmación', { timeout: 10000 }, async (t) => {
  const { conectar } = await preparar(t);
  const player = await conectar('/player');
  const response = await solicitar(player, 'unirse_a_partida', { gamePin: '1234', nickname: 'Ana' });
  assert.deepEqual(response, {
    ok: false, error: { code: 'PARTIDA_NO_EXISTE', message: 'La partida no existe o ha terminado.' }
  });
});

test('un error inesperado no expone información y el servidor sigue atendiendo', { timeout: 10000 }, async (t) => {
  const logs = [];
  const { server, conectar } = await preparar(t, { logger: { error: (message) => logs.push(message) } });
  const host = await conectar('/host');
  const crearPartida = server.gameService.crearPartida;
  server.gameService.crearPartida = () => { throw new Error('informacion-privada'); };
  const response = await solicitar(host, 'crear_partida', { gamePin: '1234' });
  assert.equal(response.error.code, 'ERROR_INTERNO');
  assert.equal(JSON.stringify({ response, logs }).includes('informacion-privada'), false);
  assert.throws(() => server.gameService.obtenerPartida('1234'), { code: 'PARTIDA_NO_EXISTE' });
  server.gameService.crearPartida = crearPartida;
  assert.equal((await solicitar(host, 'crear_partida', { gamePin: '1234' })).ok, true);
});

test('dos fábricas no comparten estado y cerrar libera el puerto y las partidas', { timeout: 10000 }, async (t) => {
  const primero = await preparar(t, { now: () => 100 });
  const segundo = await preparar(t, { now: () => 200 });
  const host1 = await primero.conectar('/host');
  const host2 = await segundo.conectar('/host');
  await solicitar(host1, 'crear_partida', { gamePin: '1234' });
  assert.throws(() => segundo.server.gameService.obtenerPartida('1234'), { code: 'PARTIDA_NO_EXISTE' });
  await solicitar(host2, 'crear_partida', { gamePin: '1234' });
  assert.equal(primero.server.gameService.obtenerPartida('1234').creadaEn, 100);
  assert.equal(segundo.server.gameService.obtenerPartida('1234').creadaEn, 200);
  const cierre = primero.server.close();
  assert.equal(cierre, primero.server.close());
  await cierre;
  assert.equal(primero.server.httpServer.listening, false);
  assert.throws(() => primero.server.gameService.obtenerPartida('1234'), { code: 'PARTIDA_NO_EXISTE' });
  assert.equal(segundo.server.gameService.obtenerPartida('1234').hostSocketId, host2.id);
});

test('se puede cerrar una fábrica que aún no está escuchando', async () => {
  const server = createGameServer();
  await server.close();
  assert.equal(server.httpServer.listening, false);
});
