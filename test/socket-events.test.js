const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { io: connect } = require('socket.io-client');
const { createGameServer } = require('../server');
const { CLIENT_CONFIG } = require('../src/config');
const { createManualClock } = require('../test-support/manual-clock');

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
  const union = await solicitar(player, 'unirse_a_partida', { gamePin: '1234', nickname: ' Ana ' });
  assert.equal(union.ok, true);
  const playerId = union.data.playerId;
  assert.notEqual(playerId, player.id);
  assert.match(union.data.token, /^[a-f0-9]{64}$/);
  assert.deepEqual(await nuevoJugador, { id: playerId, nickname: 'Ana', puntos: 0 });
  const inicio = esperar(player, 'juego_iniciado');
  assert.equal((await solicitar(host, 'iniciar_juego', { gamePin: '1234' })).ok, true);
  assert.deepEqual(await inicio, { pin: '1234' });
  const recibida = esperar(player, 'recibir_pregunta');
  const publicada = await solicitar(host, 'enviar_pregunta', {
    gamePin: '1234', pregunta: { titulo: 'Pregunta', opciones: ['A', 'B', 'C', 'D'] }
  });
  assert.equal(publicada.ok, true);
  assert.ok(publicada.data.preguntaId);
  assert.equal(publicada.data.cierraEn, 32345);
  assert.deepEqual(await recibida, publicada.data);
  const notificacion = esperar(host, 'respuesta_recibida');
  const respuesta = await solicitar(player, 'enviar_respuesta', {
    gamePin: '1234', preguntaId: publicada.data.preguntaId, respuestaSeleccionada: 1
  });
  assert.deepEqual(respuesta, { ok: true, data: {
    playerId, preguntaId: publicada.data.preguntaId, respuestaSeleccionada: 1
  } });
  assert.deepEqual(await notificacion, {
    playerId, preguntaId: publicada.data.preguntaId, respuesta: 1, totalAceptado: 1
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
  assert.equal(server.gameService.obtenerPartida('1234').players.size, 0);
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
  assert.equal(server.gameService.obtenerPartida('5678').players.size, 0);
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

async function crearSesion(conectar) {
  const host = await conectar('/host');
  const player = await conectar('/player');
  await solicitar(host, 'crear_partida', { gamePin: '1234' });
  const nuevo = esperar(host, 'nuevo_jugador');
  const { data } = await solicitar(player, 'unirse_a_partida', { gamePin: '1234', nickname: 'Ana' });
  await nuevo;
  await solicitar(host, 'iniciar_juego', { gamePin: '1234' });
  const publicada = await solicitar(host, 'enviar_pregunta', {
    gamePin: '1234', pregunta: { titulo: 'P', opciones: ['A', 'B', 'C', 'D'] }
  });
  return { host, player, data, pregunta: publicada.data };
}

async function sincronizarHost(host) {
  // Confirma que el host ya recibió todas las notificaciones anteriores.
  const response = await solicitar(host, 'crear_partida', { gamePin: '1234' });
  assert.equal(response.error.code, 'PIN_EN_USO');
}

test('uniones concurrentes y repetidas crean un solo jugador y una sola notificación', { timeout: 10000 }, async (t) => {
  const { server, conectar } = await preparar(t);
  const host = await conectar('/host');
  const player = await conectar('/player');
  await solicitar(host, 'crear_partida', { gamePin: '1234' });
  const notificaciones = [];
  host.on('nuevo_jugador', (data) => notificaciones.push(data));
  const payload = { gamePin: '1234', nickname: 'Ana' };
  const [primera, segunda] = await Promise.all([
    solicitar(player, 'unirse_a_partida', payload), solicitar(player, 'unirse_a_partida', payload)
  ]);
  assert.deepEqual(segunda, primera);
  assert.deepEqual(await solicitar(player, 'unirse_a_partida', { ...payload, nickname: 'Otro' }), primera);
  await sincronizarHost(host);
  assert.equal(notificaciones.length, 1);
  assert.equal(server.gameService.obtenerPartida('1234').players.size, 1);
  assert.deepEqual(server.io.of('/player').sockets.get(player.id).data, {
    gamePin: '1234', playerId: primera.data.playerId
  });
  assert.equal(JSON.stringify(notificaciones).includes(primera.data.token), false);
  assert.equal(notificaciones[0].token, undefined);
});

test('ignorar el primer acuse y repetir la unión recupera el mismo registro', { timeout: 10000 }, async (t) => {
  const { server, conectar } = await preparar(t);
  const host = await conectar('/host');
  const player = await conectar('/player');
  await solicitar(host, 'crear_partida', { gamePin: '1234' });
  const nuevo = esperar(host, 'nuevo_jugador');
  player.emit('unirse_a_partida', { gamePin: '1234', nickname: 'Ana' }, () => {});
  const registrado = await nuevo;
  const repetida = await solicitar(player, 'unirse_a_partida', { gamePin: '1234', nickname: 'Ana' });
  assert.equal(repetida.data.playerId, registrado.id);
  assert.equal(server.gameService.obtenerPartida('1234').players.size, 1);
  assert.deepEqual(await solicitar(player, 'unirse_a_partida', { gamePin: '1234', nickname: 'Ana' }), repetida);
});

test('una recuperación conserva identidad y pregunta sin volver a notificar una unión', { timeout: 10000 }, async (t) => {
  const { server, conectar } = await preparar(t);
  const { host, player, data } = await crearSesion(conectar);
  const publicada = await solicitar(host, 'enviar_pregunta', {
    gamePin: '1234', pregunta: { titulo: 'P', opciones: ['A', 'B', 'C', 'D'] }
  });
  const desconectado = once(server.io.of('/player').sockets.get(player.id), 'disconnect');
  player.disconnect();
  await desconectado;
  let notificaciones = 0;
  host.on('nuevo_jugador', () => notificaciones++);
  const recuperado = await conectar('/player');
  const reanudada = await solicitar(recuperado, 'reanudar_sesion', { gamePin: '1234', token: data.token });
  assert.equal(reanudada.ok, true);
  assert.equal(reanudada.data.playerId, data.playerId);
  assert.equal(reanudada.data.token, data.token);
  assert.deepEqual(reanudada.data.pregunta, publicada.data);
  assert.deepEqual(await solicitar(recuperado, 'reanudar_sesion', { gamePin: '1234', token: data.token }), reanudada);
  assert.deepEqual(await solicitar(recuperado, 'unirse_a_partida', { gamePin: '1234', nickname: 'Otro' }), reanudada);
  await sincronizarHost(host);
  assert.equal(notificaciones, 0);
  assert.equal(server.gameService.obtenerPartida('1234').players.size, 1);
  const respuesta = await solicitar(recuperado, 'enviar_respuesta', {
    gamePin: '1234', preguntaId: publicada.data.preguntaId, respuestaSeleccionada: 0, playerId: 'falso'
  });
  assert.equal(respuesta.data.playerId, data.playerId);
});

test('reanudar invalida y desconecta la conexión anterior y mantiene la nueva', { timeout: 10000 }, async (t) => {
  const { server, conectar } = await preparar(t);
  const { player, data, pregunta } = await crearSesion(conectar);
  const servidorAnterior = server.io.of('/player').sockets.get(player.id);
  const reemplazada = esperar(player, 'sesion_reemplazada');
  const desconectada = esperar(player, 'disconnect');
  const nuevo = await conectar('/player');
  assert.equal((await solicitar(nuevo, 'reanudar_sesion', { gamePin: '1234', token: data.token })).ok, true);
  assert.equal((await reemplazada).message, 'La sesión se abrió en otra conexión.');
  assert.equal(await desconectada, 'io server disconnect');
  assert.equal(servidorAnterior.connected, false);
  assert.deepEqual(servidorAnterior.data, {});
  assert.equal(servidorAnterior.rooms.has('1234'), false);
  const respuesta = await solicitar(nuevo, 'enviar_respuesta', {
    gamePin: '1234', preguntaId: pregunta.preguntaId, respuestaSeleccionada: 1
  });
  assert.equal(respuesta.data.playerId, data.playerId);
  assert.equal(server.gameService.obtenerPartida('1234').players.size, 1);
});

test('tokens falsos, malformados o de otra partida se rechazan sin revocar la sesión válida', { timeout: 10000 }, async (t) => {
  const { server, conectar } = await preparar(t);
  const { host, player, data, pregunta } = await crearSesion(conectar);
  await solicitar(host, 'crear_partida', { gamePin: '5678' });
  const ajeno = await conectar('/player');
  for (const payload of [
    { gamePin: '1234', token: '0'.repeat(64) }, { gamePin: '1234', token: 'incorrecto' },
    { gamePin: '5678', token: data.token }
  ]) {
    const response = await solicitar(ajeno, 'reanudar_sesion', payload);
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'SESION_INVALIDA');
  }
  const socketAjeno = server.io.of('/player').sockets.get(ajeno.id);
  assert.deepEqual(socketAjeno.data, {});
  assert.equal(socketAjeno.rooms.has('1234'), false);
  assert.equal(socketAjeno.rooms.has('5678'), false);
  assert.equal(player.connected, true);
  assert.equal((await solicitar(player, 'enviar_respuesta', {
    gamePin: '1234', preguntaId: pregunta.preguntaId, respuestaSeleccionada: 1
  })).data.playerId, data.playerId);
});

test('responder desde otra conexión, otra partida o solo una room no notifica al profesor', { timeout: 10000 }, async (t) => {
  const { server, conectar } = await preparar(t);
  const { host, player, data } = await crearSesion(conectar);
  await solicitar(host, 'crear_partida', { gamePin: '5678' });
  let respuestas = 0;
  host.on('respuesta_recibida', () => respuestas++);
  const ajeno = await conectar('/player');
  await server.io.of('/player').sockets.get(ajeno.id).join('1234');
  const payload = { gamePin: '1234', preguntaId: 'pregunta', respuestaSeleccionada: 1, playerId: data.playerId, token: data.token };
  for (const [socket, solicitud] of [[ajeno, payload], [player, { ...payload, gamePin: '5678' }]]) {
    const response = await solicitar(socket, 'enviar_respuesta', solicitud);
    assert.equal(response.error.code, 'NO_PERTENECE');
  }
  await sincronizarHost(host);
  assert.equal(respuestas, 0);
  assert.equal(server.gameService.obtenerPartida('1234').players.size, 1);
  assert.equal(server.gameService.obtenerPartida('5678').players.size, 0);
});

test('una conexión asociada no se une ni reanuda otra partida', { timeout: 10000 }, async (t) => {
  const { server, conectar } = await preparar(t);
  const { host, player } = await crearSesion(conectar);
  await solicitar(host, 'crear_partida', { gamePin: '5678' });
  const otro = await conectar('/player');
  const sesionOtra = await solicitar(otro, 'unirse_a_partida', { gamePin: '5678', nickname: 'Luis' });
  for (const [evento, payload] of [
    ['unirse_a_partida', { gamePin: '5678', nickname: 'Ana' }],
    ['reanudar_sesion', { gamePin: '5678', token: sesionOtra.data.token }]
  ]) {
    assert.equal((await solicitar(player, evento, payload)).error.code, 'SESION_INVALIDA');
  }
  assert.equal(server.gameService.obtenerPartida('1234').players.size, 1);
  assert.equal(server.gameService.obtenerPartida('5678').players.size, 1);
  assert.equal(otro.connected, true);
});

test('reanudar sin callback se descarta y cerrar la instancia invalida sus tokens', { timeout: 10000 }, async (t) => {
  const { server, conectar } = await preparar(t);
  const { player, data } = await crearSesion(conectar);
  const nuevo = await conectar('/player');
  nuevo.emit('reanudar_sesion', { gamePin: '1234', token: data.token });
  const response = await solicitar(nuevo, 'enviar_respuesta', {
    gamePin: '1234', preguntaId: 'pregunta', respuestaSeleccionada: 1
  });
  assert.equal(response.error.code, 'NO_PERTENECE');
  assert.equal(player.connected, true);
  await server.close();
  const otra = await preparar(t);
  const recuperado = await otra.conectar('/player');
  const invalidada = await solicitar(recuperado, 'reanudar_sesion', { gamePin: '1234', token: data.token });
  assert.equal(invalidada.error.code, 'SESION_INVALIDA');
});

test('otro profesor ni siquiera en la room puede iniciar o publicar preguntas ajenas', { timeout: 10000 }, async (t) => {
  const clock = createManualClock();
  const { server, conectar } = await preparar(t, clock);
  const host = await conectar('/host');
  const ajeno = await conectar('/host');
  const player = await conectar('/player');
  await solicitar(host, 'crear_partida', { gamePin: '1234' });
  await solicitar(player, 'unirse_a_partida', { gamePin: '1234', nickname: 'Ana' });
  await server.io.of('/host').sockets.get(ajeno.id).join('1234');
  const eventos = [];
  player.on('juego_iniciado', (data) => eventos.push(data));
  player.on('recibir_pregunta', (data) => eventos.push(data));
  assert.equal((await solicitar(ajeno, 'iniciar_juego', { gamePin: '1234' })).error.code, 'NO_AUTORIZADO');
  const pregunta = { titulo: 'P', opciones: ['A', 'B', 'C', 'D'] };
  assert.equal((await solicitar(ajeno, 'enviar_pregunta', { gamePin: '1234', pregunta })).error.code, 'NO_AUTORIZADO');
  assert.equal((await solicitar(host, 'enviar_pregunta', { gamePin: '1234', pregunta })).error.code, 'JUEGO_NO_INICIADO');
  await solicitar(player, 'unirse_a_partida', { gamePin: '1234', nickname: 'Ana' });
  assert.deepEqual(eventos, []);
  const partida = server.gameService.obtenerPartida('1234');
  assert.equal(partida.estado, 'lobby');
  assert.equal(partida.preguntas.size, 0);
  assert.equal(clock.pending.size, 0);
  await solicitar(host, 'iniciar_juego', { gamePin: '1234' });
  await solicitar(host, 'enviar_pregunta', { gamePin: '1234', pregunta });
  const activa = partida.preguntaActual;
  const timer = partida.temporizador;
  assert.equal((await solicitar(ajeno, 'enviar_pregunta', { gamePin: '1234', pregunta })).error.code, 'NO_AUTORIZADO');
  assert.equal(partida.preguntaActual, activa);
  assert.equal(partida.temporizador, timer);
});

test('un PIN ocupado conserva profesor, pregunta, temporizador y sesión existentes', { timeout: 10000 }, async (t) => {
  const clock = createManualClock();
  const { server, conectar } = await preparar(t, clock);
  const { player, data, pregunta } = await crearSesion(conectar);
  const partida = server.gameService.obtenerPartida('1234');
  const timer = partida.temporizador;
  const ajeno = await conectar('/host');
  assert.equal((await solicitar(ajeno, 'crear_partida', { gamePin: '1234' })).error.code, 'PIN_EN_USO');
  assert.equal(server.gameService.obtenerPartida('1234'), partida);
  assert.equal(partida.temporizador, timer);
  assert.equal(partida.preguntas.size, 1);
  assert.equal(partida.players.size, 1);
  assert.equal(server.io.of('/host').sockets.get(ajeno.id).rooms.has('1234'), false);
  const respuesta = await solicitar(player, 'enviar_respuesta', {
    gamePin: '1234', preguntaId: pregunta.preguntaId, respuestaSeleccionada: 0
  });
  assert.equal(respuesta.data.playerId, data.playerId);
});

test('preguntas inválidas o sin callback no sustituyen la activa ni su plazo', { timeout: 10000 }, async (t) => {
  const clock = createManualClock();
  const { server, conectar } = await preparar(t, clock);
  const { host, pregunta } = await crearSesion(conectar);
  const partida = server.gameService.obtenerPartida('1234');
  const timer = partida.temporizador;
  for (const invalida of [
    { titulo: '', opciones: ['A', 'B', 'C', 'D'] },
    { titulo: 'P', opciones: ['A', 'B', 'C'] },
    { titulo: 'P', opciones: ['A', 'B', 'C', ' '] }
  ]) {
    assert.equal((await solicitar(host, 'enviar_pregunta', { gamePin: '1234', pregunta: invalida })).error.code, 'DATOS_INVALIDOS');
  }
  host.emit('enviar_pregunta', { gamePin: '1234', pregunta: { titulo: 'Otra', opciones: ['A', 'B', 'C', 'D'] } });
  await sincronizarHost(host);
  assert.equal(partida.preguntaActual.preguntaId, pregunta.preguntaId);
  assert.equal(partida.temporizador, timer);
  assert.equal(partida.preguntas.size, 1);
  assert.equal(clock.scheduled.length, 1);
});

test('respuestas sin pregunta, antiguas o fuera de plazo no notifican ni alteran contadores', { timeout: 10000 }, async (t) => {
  const clock = createManualClock();
  const { server, conectar } = await preparar(t, clock);
  const host = await conectar('/host');
  const player = await conectar('/player');
  await solicitar(host, 'crear_partida', { gamePin: '1234' });
  await solicitar(player, 'unirse_a_partida', { gamePin: '1234', nickname: 'Ana' });
  const respuestas = [];
  host.on('respuesta_recibida', (data) => respuestas.push(data));
  const payload = { gamePin: '1234', preguntaId: 'inventada', respuestaSeleccionada: 0 };
  assert.equal((await solicitar(player, 'enviar_respuesta', payload)).error.code, 'SIN_PREGUNTA_ACTIVA');
  await solicitar(host, 'iniciar_juego', { gamePin: '1234' });
  assert.equal((await solicitar(player, 'enviar_respuesta', payload)).error.code, 'SIN_PREGUNTA_ACTIVA');
  const { data: primera } = await solicitar(host, 'enviar_pregunta', {
    gamePin: '1234', pregunta: { titulo: 'Primera', opciones: ['A', 'B', 'C', 'D'] }, cierraEn: Infinity
  });
  assert.equal(primera.cierraEn, 21000);
  clock.advanceTo(2000);
  const { data: segunda } = await solicitar(host, 'enviar_pregunta', {
    gamePin: '1234', pregunta: { titulo: 'Segunda', opciones: ['A', 'B', 'C', 'D'] }
  });
  assert.equal((await solicitar(player, 'enviar_respuesta', { ...payload, preguntaId: primera.preguntaId })).error.code, 'PREGUNTA_INCORRECTA');
  assert.equal((await solicitar(player, 'enviar_respuesta', payload)).error.code, 'PREGUNTA_INCORRECTA');
  clock.advanceTo(segunda.cierraEn);
  assert.equal((await solicitar(player, 'enviar_respuesta', { ...payload, preguntaId: segunda.preguntaId })).error.code, 'PLAZO_CERRADO');
  clock.advanceTo(segunda.cierraEn + 1);
  assert.equal((await solicitar(player, 'enviar_respuesta', { ...payload, preguntaId: segunda.preguntaId })).error.code, 'PLAZO_CERRADO');
  await sincronizarHost(host);
  assert.deepEqual(respuestas, []);
  assert.equal(server.gameService.obtenerPartida('1234').preguntaActual.respuestas.size, 0);
  assert.equal(clock.pending.size, 1);
});

test('el cierre notifica una vez a profesor y jugadores de la partida y rechaza nuevas respuestas', { timeout: 10000 }, async (t) => {
  const clock = createManualClock();
  const { server, conectar } = await preparar(t, clock);
  const { host, player, pregunta } = await crearSesion(conectar);
  const segundo = await conectar('/player');
  await solicitar(segundo, 'unirse_a_partida', { gamePin: '1234', nickname: 'Luis' });
  const ajeno = await conectar('/player');
  const eventosAjenos = [];
  ajeno.on('pregunta_cerrada', (data) => eventosAjenos.push(data));
  const cierres = [];
  player.on('pregunta_cerrada', (data) => cierres.push(data));
  const notificaciones = [host, player, segundo].map((socket) => esperar(socket, 'pregunta_cerrada'));
  const timer = clock.scheduled[0];
  clock.advanceTo(pregunta.cierraEn);
  clock.fire(timer);
  clock.fire(timer);
  for (const data of await Promise.all(notificaciones)) assert.deepEqual(data, { preguntaId: pregunta.preguntaId });
  assert.equal((await solicitar(segundo, 'enviar_respuesta', {
    gamePin: '1234', preguntaId: pregunta.preguntaId, respuestaSeleccionada: 0
  })).error.code, 'PLAZO_CERRADO');
  await sincronizarHost(host);
  assert.deepEqual(cierres, [{ preguntaId: pregunta.preguntaId }]);
  assert.deepEqual(eventosAjenos, []);
  assert.equal(server.gameService.obtenerPartida('1234').preguntaActual.abierta, false);
  assert.equal(clock.pending.size, 0);
});

test('un callback antiguo no emite cierre para la pregunta nueva y close cancela sus recursos', { timeout: 10000 }, async (t) => {
  const clock = createManualClock();
  const { server, conectar } = await preparar(t, clock);
  const { host, player } = await crearSesion(conectar);
  const anterior = clock.scheduled[0];
  const cierres = [];
  player.on('pregunta_cerrada', (data) => cierres.push(data));
  clock.advanceTo(2000);
  const { data: nueva } = await solicitar(host, 'enviar_pregunta', {
    gamePin: '1234', pregunta: { titulo: 'Nueva', opciones: ['A', 'B', 'C', 'D'] }
  });
  assert.equal(clock.pending.has(anterior), false);
  clock.advanceTo(21000);
  clock.fire(anterior);
  assert.equal((await solicitar(player, 'enviar_respuesta', {
    gamePin: '1234', preguntaId: nueva.preguntaId, respuestaSeleccionada: 0
  })).ok, true);
  assert.deepEqual(cierres, []);
  const actual = clock.scheduled.at(-1);
  await server.close();
  assert.equal(clock.pending.size, 0);
  clock.advanceTo(30000);
  clock.fire(actual);
  assert.deepEqual(cierres, []);
});

test('reanudar una pregunta vencida informa cierre con el reloj del servidor', { timeout: 10000 }, async (t) => {
  const clock = createManualClock();
  const { conectar } = await preparar(t, clock);
  const { player, data, pregunta } = await crearSesion(conectar);
  clock.advanceTo(pregunta.cierraEn);
  player.disconnect();
  const nuevo = await conectar('/player');
  const recuperada = await solicitar(nuevo, 'reanudar_sesion', { gamePin: '1234', token: data.token });
  assert.equal(recuperada.ok, true);
  assert.equal(recuperada.data.estado, 'en_curso');
  assert.equal(recuperada.data.preguntaAbierta, false);
  assert.deepEqual(recuperada.data.pregunta, pregunta);
  assert.equal((await solicitar(nuevo, 'enviar_respuesta', {
    gamePin: '1234', preguntaId: pregunta.preguntaId, respuestaSeleccionada: 0
  })).error.code, 'PLAZO_CERRADO');
});

test('opciones inválidas y respuestas sin callback no registran ni notifican al profesor', { timeout: 10000 }, async (t) => {
  const { server, conectar } = await preparar(t, createManualClock());
  const { host, player, pregunta } = await crearSesion(conectar);
  const notificaciones = [];
  host.on('respuesta_recibida', (data) => notificaciones.push(data));
  const payload = { gamePin: '1234', preguntaId: pregunta.preguntaId, respuestaSeleccionada: 0 };
  player.emit('enviar_respuesta', payload);
  for (const respuestaSeleccionada of [undefined, null, '0', false, [], {}, 0.5, -1, 4]) {
    const rechazo = await solicitar(player, 'enviar_respuesta', { ...payload, respuestaSeleccionada });
    assert.equal(rechazo.ok, false);
    assert.equal(rechazo.error.code, 'OPCION_INVALIDA');
  }
  for (const invalido of [undefined, null, [], {}, { ...payload, gamePin: 1234 }, { ...payload, preguntaId: '' }]) {
    assert.equal((await solicitar(player, 'enviar_respuesta', invalido)).error.code, 'DATOS_INVALIDOS');
  }
  const extra = await player.timeout(2000).emitWithAck('enviar_respuesta', payload, 'extra');
  assert.equal(extra.error.code, 'DATOS_INVALIDOS');
  await sincronizarHost(host);
  assert.equal(server.gameService.obtenerPartida('1234').preguntaActual.respuestas.size, 0);
  assert.deepEqual(notificaciones, []);
});

test('dos envíos simultáneos idénticos confirman lo mismo con un registro y una notificación', { timeout: 10000 }, async (t) => {
  const { server, conectar } = await preparar(t, createManualClock());
  const { host, player, data, pregunta } = await crearSesion(conectar);
  const notificaciones = [];
  const registrosAlNotificar = [];
  host.on('respuesta_recibida', (evento) => {
    notificaciones.push(evento);
    registrosAlNotificar.push(server.gameService.obtenerPartida('1234').preguntas.get(evento.preguntaId).respuestas.get(evento.playerId));
  });
  const payload = { gamePin: '1234', preguntaId: pregunta.preguntaId, respuestaSeleccionada: 1, totalAceptado: 99 };
  const [primera, segunda] = await Promise.all([
    solicitar(player, 'enviar_respuesta', payload), solicitar(player, 'enviar_respuesta', payload)
  ]);
  assert.deepEqual(segunda, primera);
  assert.equal(primera.ok, true);
  await sincronizarHost(host);
  assert.equal(server.gameService.obtenerPartida('1234').preguntaActual.respuestas.size, 1);
  assert.deepEqual(registrosAlNotificar, [primera.data]);
  assert.deepEqual(notificaciones, [{ playerId: data.playerId, preguntaId: pregunta.preguntaId, respuesta: 1, totalAceptado: 1 }]);
  assert.equal((await solicitar(player, 'enviar_respuesta', { ...payload, respuestaSeleccionada: 2 })).error.code, 'YA_RESPONDIO');
  await sincronizarHost(host);
  assert.equal(notificaciones.length, 1);
});

test('dos opciones simultáneas para un jugador aceptan una sola y rechazan el cambio', { timeout: 10000 }, async (t) => {
  const { server, conectar } = await preparar(t, createManualClock());
  const { host, player, data, pregunta } = await crearSesion(conectar);
  const notificaciones = [];
  host.on('respuesta_recibida', (evento) => notificaciones.push(evento));
  const payload = { gamePin: '1234', preguntaId: pregunta.preguntaId };
  const resultados = await Promise.all([0, 3].map((respuestaSeleccionada) => solicitar(player, 'enviar_respuesta', { ...payload, respuestaSeleccionada })));
  assert.equal(resultados.filter((response) => response.ok).length, 1);
  assert.equal(resultados.find((response) => !response.ok).error.code, 'YA_RESPONDIO');
  const aceptada = resultados.find((response) => response.ok).data;
  await sincronizarHost(host);
  assert.deepEqual(server.gameService.obtenerPartida('1234').preguntaActual.respuestas.get(data.playerId), aceptada);
  assert.equal(server.gameService.obtenerPartida('1234').preguntaActual.respuestas.size, 1);
  assert.equal(notificaciones.length, 1);
  assert.equal(notificaciones[0].respuesta, aceptada.respuestaSeleccionada);
  assert.equal(notificaciones[0].totalAceptado, 1);
});

test('perder realmente el acuse causa timeout y reintentar tras el cierre confirma sin duplicar', { timeout: 10000 }, async (t) => {
  const clock = createManualClock();
  const { server, conectar } = await preparar(t, clock);
  const { host, player, data, pregunta } = await crearSesion(conectar);
  const servidorPlayer = server.io.of('/player').sockets.get(player.id);
  const [handler] = servidorPlayer.listeners('enviar_respuesta');
  servidorPlayer.off('enviar_respuesta', handler);
  let perderAcuse = true;
  servidorPlayer.on('enviar_respuesta', (payload, callback) => {
    if (perderAcuse) {
      perderAcuse = false;
      // Ejecutar la operación completa y descartar únicamente su primer acuse.
      return handler(payload, () => {});
    }
    return handler(payload, callback);
  });
  const notificaciones = [];
  host.on('respuesta_recibida', (evento) => notificaciones.push(evento));
  const payload = { gamePin: '1234', preguntaId: pregunta.preguntaId, respuestaSeleccionada: 2 };
  const recibida = esperar(host, 'respuesta_recibida');
  const timeout = assert.rejects(player.timeout(50).emitWithAck('enviar_respuesta', payload));
  await recibida;
  await timeout;
  const registrada = server.gameService.obtenerPartida('1234').preguntaActual.respuestas.get(data.playerId);
  assert.deepEqual(registrada, { playerId: data.playerId, preguntaId: pregunta.preguntaId, respuestaSeleccionada: 2 });
  clock.advanceTo(pregunta.cierraEn);
  const cierre = esperar(player, 'pregunta_cerrada');
  clock.fire(clock.scheduled[0]);
  await cierre;
  assert.deepEqual(await solicitar(player, 'enviar_respuesta', payload), { ok: true, data: registrada });
  assert.equal((await solicitar(player, 'enviar_respuesta', { ...payload, respuestaSeleccionada: 0 })).error.code, 'YA_RESPONDIO');
  await sincronizarHost(host);
  assert.equal(notificaciones.length, 1);
  assert.equal(notificaciones[0].totalAceptado, 1);
  assert.equal(server.gameService.obtenerPartida('1234').preguntaActual.respuestas.size, 1);
});

test('los totales cuentan jugadores únicos por pregunta y los reintentos anteriores conservan su acuse', { timeout: 10000 }, async (t) => {
  const { server, conectar } = await preparar(t, createManualClock());
  const { host, player, data, pregunta } = await crearSesion(conectar);
  const otro = await conectar('/player');
  const { data: otroJugador } = await solicitar(otro, 'unirse_a_partida', { gamePin: '1234', nickname: 'Ana' });
  const notificaciones = [];
  host.on('respuesta_recibida', (evento) => notificaciones.push(evento));
  const payload = { gamePin: '1234', preguntaId: pregunta.preguntaId, respuestaSeleccionada: 0 };
  const primera = await solicitar(player, 'enviar_respuesta', payload);
  const segunda = await solicitar(otro, 'enviar_respuesta', { ...payload, playerId: data.playerId, token: data.token });
  assert.equal(segunda.data.playerId, otroJugador.playerId);
  assert.notEqual(segunda.data.playerId, primera.data.playerId);
  assert.deepEqual(await solicitar(player, 'enviar_respuesta', payload), primera);
  const { data: nueva } = await solicitar(host, 'enviar_pregunta', {
    gamePin: '1234', pregunta: { titulo: 'Nueva', opciones: ['A', 'B', 'C', 'D'] }
  });
  assert.deepEqual(await solicitar(player, 'enviar_respuesta', payload), primera);
  assert.equal((await solicitar(player, 'enviar_respuesta', { ...payload, respuestaSeleccionada: 1 })).error.code, 'YA_RESPONDIO');
  const nuevaAceptada = await solicitar(player, 'enviar_respuesta', { ...payload, preguntaId: nueva.preguntaId, respuestaSeleccionada: 3 });
  assert.equal(nuevaAceptada.ok, true);
  await sincronizarHost(host);
  assert.deepEqual(notificaciones.map(({ preguntaId, totalAceptado }) => ({ preguntaId, totalAceptado })), [
    { preguntaId: pregunta.preguntaId, totalAceptado: 1 },
    { preguntaId: pregunta.preguntaId, totalAceptado: 2 },
    { preguntaId: nueva.preguntaId, totalAceptado: 1 }
  ]);
  assert.equal(server.gameService.obtenerPartida('1234').preguntas.get(pregunta.preguntaId).respuestas.size, 2);
  assert.equal(server.gameService.obtenerPartida('1234').preguntaActual.respuestas.size, 1);
});

test('reanudar una respuesta aceptada conserva la deduplicación incluso después del cierre', { timeout: 10000 }, async (t) => {
  const clock = createManualClock();
  const { server, conectar } = await preparar(t, clock);
  const { host, player, data, pregunta } = await crearSesion(conectar);
  const notificaciones = [];
  host.on('respuesta_recibida', (evento) => notificaciones.push(evento));
  const payload = { gamePin: '1234', preguntaId: pregunta.preguntaId, respuestaSeleccionada: 1 };
  const aceptada = await solicitar(player, 'enviar_respuesta', payload);
  const desconectado = once(server.io.of('/player').sockets.get(player.id), 'disconnect');
  player.disconnect();
  await desconectado;
  clock.advanceTo(pregunta.cierraEn + 1);
  const nuevo = await conectar('/player');
  assert.equal((await solicitar(nuevo, 'reanudar_sesion', { gamePin: '1234', token: data.token })).ok, true);
  assert.deepEqual(await solicitar(nuevo, 'enviar_respuesta', payload), aceptada);
  assert.equal((await solicitar(nuevo, 'enviar_respuesta', { ...payload, respuestaSeleccionada: 2 })).error.code, 'YA_RESPONDIO');
  const ajeno = await conectar('/player');
  assert.equal((await solicitar(ajeno, 'enviar_respuesta', { ...payload, playerId: data.playerId, token: data.token })).error.code, 'NO_PERTENECE');
  await sincronizarHost(host);
  assert.equal(notificaciones.length, 1);
  assert.equal(server.gameService.obtenerPartida('1234').preguntaActual.respuestas.size, 1);
});

test('un error inesperado de respuesta confirma ERROR_INTERNO sin registros ni notificaciones', { timeout: 10000 }, async (t) => {
  const logs = [];
  const { server, conectar } = await preparar(t, { ...createManualClock(), logger: { error: (message) => logs.push(message) } });
  const { host, player, pregunta } = await crearSesion(conectar);
  const notificaciones = [];
  host.on('respuesta_recibida', (evento) => notificaciones.push(evento));
  const enviar = server.gameService.enviarRespuesta;
  server.gameService.enviarRespuesta = () => { throw new Error('detalle-privado'); };
  const payload = { gamePin: '1234', preguntaId: pregunta.preguntaId, respuestaSeleccionada: 0 };
  const rechazada = await solicitar(player, 'enviar_respuesta', payload);
  assert.equal(rechazada.error.code, 'ERROR_INTERNO');
  assert.equal(JSON.stringify({ rechazada, logs }).includes('detalle-privado'), false);
  await sincronizarHost(host);
  assert.equal(server.gameService.obtenerPartida('1234').preguntaActual.respuestas.size, 0);
  assert.deepEqual(notificaciones, []);
  server.gameService.enviarRespuesta = enviar;
  assert.equal((await solicitar(player, 'enviar_respuesta', payload)).ok, true);
});

test('consultar_estado valida payload y pertenencia, y devuelve la aceptación de la sesión', { timeout: 10000 }, async (t) => {
  const clock = createManualClock();
  const { server, conectar } = await preparar(t, clock);
  const { host, player, data, pregunta } = await crearSesion(conectar);
  for (const payload of [null, [], {}, { gamePin: 1234 }]) {
    assert.equal((await solicitar(player, 'consultar_estado', payload)).error.code, 'DATOS_INVALIDOS');
  }
  const ajeno = await conectar('/player');
  assert.equal((await solicitar(ajeno, 'consultar_estado', { gamePin: '1234', playerId: data.playerId, token: data.token })).error.code, 'NO_PERTENECE');
  const inicial = await solicitar(player, 'consultar_estado', { gamePin: '1234' });
  assert.deepEqual(inicial.data, { pin: '1234', estado: 'en_curso', pregunta, preguntaAbierta: true, respuesta: null });
  const aceptada = await solicitar(player, 'enviar_respuesta', { gamePin: '1234', preguntaId: pregunta.preguntaId, respuestaSeleccionada: 1 });
  clock.advanceTo(pregunta.cierraEn);
  const snapshot = await solicitar(player, 'consultar_estado', { gamePin: '1234' });
  assert.equal(snapshot.data.preguntaAbierta, false);
  assert.deepEqual(snapshot.data.respuesta, aceptada.data);
  assert.equal(snapshot.data.token, undefined);
  player.emit('consultar_estado', { gamePin: '1234' });
  const nuevo = await conectar('/player');
  const recuperada = await solicitar(nuevo, 'reanudar_sesion', { gamePin: '1234', token: data.token });
  assert.deepEqual(recuperada.data.respuesta, aceptada.data);
  await sincronizarHost(host);
  assert.equal(server.gameService.obtenerPartida('1234').preguntaActual.respuestas.size, 1);
});

test('desconectar al profesor notifica el fin, elimina recursos y permite otra partida en la misma conexión', { timeout: 10000 }, async (t) => {
  const clock = createManualClock();
  const { server, conectar } = await preparar(t, clock);
  const { host, player, data, pregunta } = await crearSesion(conectar);
  const segundo = await conectar('/player');
  const sesion2 = await solicitar(segundo, 'unirse_a_partida', { gamePin: '1234', nickname: 'Luis' });
  await solicitar(player, 'enviar_respuesta', { gamePin: '1234', preguntaId: pregunta.preguntaId, respuestaSeleccionada: 0 });
  const partida = server.gameService.obtenerPartida('1234');
  const timer = partida.temporizador;
  const finalizadas = [player, segundo].map((cliente) => esperar(cliente, 'partida_finalizada'));
  host.disconnect();
  for (const aviso of await Promise.all(finalizadas)) {
    assert.equal(aviso.pin, '1234');
    assert.match(aviso.motivo, /profesor se desconectó/);
  }
  assert.equal(partida.players.size, 0);
  assert.equal(partida.preguntas.size, 0);
  assert.equal(clock.pending.size, 0);
  assert.throws(() => server.gameService.obtenerPartida('1234'), { code: 'PARTIDA_NO_EXISTE' });
  for (const cliente of [player, segundo]) {
    const serverPlayer = server.io.of('/player').sockets.get(cliente.id);
    assert.deepEqual(serverPlayer.data, {});
    assert.equal(serverPlayer.rooms.has('1234'), false);
  }
  assert.equal((await solicitar(player, 'consultar_estado', { gamePin: '1234' })).error.code, 'PARTIDA_NO_EXISTE');
  assert.equal((await solicitar(segundo, 'reanudar_sesion', { gamePin: '1234', token: sesion2.data.token })).error.code, 'SESION_INVALIDA');
  const host2 = await conectar('/host');
  await solicitar(host2, 'crear_partida', { gamePin: '1234' });
  assert.equal((await solicitar(player, 'reanudar_sesion', { gamePin: '1234', token: data.token })).error.code, 'SESION_INVALIDA');
  assert.equal((await solicitar(player, 'unirse_a_partida', { gamePin: '1234', nickname: 'Ana' })).ok, true);
  clock.advanceTo(pregunta.cierraEn);
  clock.fire(timer);
  assert.equal(server.gameService.obtenerPartida('1234').estado, 'lobby');
});

test('salir un jugador conserva su respuesta y salir un profesor ajeno conserva la partida', { timeout: 10000 }, async (t) => {
  const { server, conectar } = await preparar(t, createManualClock());
  const { player, data, pregunta } = await crearSesion(conectar);
  const aceptada = await solicitar(player, 'enviar_respuesta', { gamePin: '1234', preguntaId: pregunta.preguntaId, respuestaSeleccionada: 1 });
  const desconectado = once(server.io.of('/player').sockets.get(player.id), 'disconnect');
  player.disconnect();
  await desconectado;
  const ajeno = await conectar('/host');
  const hostDesconectado = once(server.io.of('/host').sockets.get(ajeno.id), 'disconnect');
  ajeno.disconnect();
  await hostDesconectado;
  assert.equal(server.gameService.obtenerPartida('1234').preguntaActual.respuestas.size, 1);
  const nuevo = await conectar('/player');
  const recuperada = await solicitar(nuevo, 'reanudar_sesion', { gamePin: '1234', token: data.token });
  assert.deepEqual(recuperada.data.respuesta, aceptada.data);
});

test('el profesor recibe la pregunta antes de las notificaciones de respuesta', { timeout: 10000 }, async (t) => {
  const { conectar } = await preparar(t, createManualClock());
  const { host, player } = await crearSesion(conectar);
  // Esperar los eventos iniciales del jugador antes de escuchar la siguiente pregunta.
  await solicitar(player, 'consultar_estado', { gamePin: '1234' });
  const eventos = [];
  host.on('recibir_pregunta', (data) => eventos.push({ tipo: 'pregunta', id: data.preguntaId }));
  host.on('respuesta_recibida', (data) => eventos.push({ tipo: 'respuesta', id: data.preguntaId }));
  const recibida = esperar(player, 'recibir_pregunta');
  const publicacion = solicitar(host, 'enviar_pregunta', { gamePin: '1234', pregunta: { titulo: 'Otra', opciones: ['A', 'B', 'C', 'D'] } });
  const pregunta = await recibida;
  await solicitar(player, 'enviar_respuesta', { gamePin: '1234', preguntaId: pregunta.preguntaId, respuestaSeleccionada: 0 });
  await publicacion;
  await sincronizarHost(host);
  assert.deepEqual(eventos, [{ tipo: 'pregunta', id: pregunta.preguntaId }, { tipo: 'respuesta', id: pregunta.preguntaId }]);
});
