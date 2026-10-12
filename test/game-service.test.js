const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createGameService: createService } = require('../src/game-service');
const { CONFIG } = require('../src/config');
const { createManualClock } = require('../test-support/manual-clock');

const servicios = new Set();
function createGameService(options) {
  const service = createService(options);
  servicios.add(service);
  return service;
}

afterEach(() => {
  for (const service of servicios) service.cerrar();
  servicios.clear();
});

test('cada servicio conserva un estado aislado e incorpora el reloj inyectado', () => {
  const primero = createGameService({ now: () => 123 });
  const segundo = createGameService({ now: () => 456 });
  primero.crearPartida('host-1', { gamePin: '1234' });
  assert.throws(() => segundo.obtenerPartida('1234'), { code: 'PARTIDA_NO_EXISTE' });
  segundo.crearPartida('host-2', { gamePin: '1234' });
  assert.equal(primero.obtenerPartida('1234').creadaEn, 123);
  assert.equal(segundo.obtenerPartida('1234').creadaEn, 456);
  assert.equal(primero.obtenerPartida('1234').hostSocketId, 'host-1');
  assert.equal(segundo.obtenerPartida('1234').hostSocketId, 'host-2');
});

test('el flujo existente incorpora un jugador y una pregunta con identidad del servidor', () => {
  const service = createGameService({ now: () => 789 });
  service.crearPartida('host', { gamePin: '1234' });
  const union = service.unirseAPartida('player-socket', { gamePin: '1234', nickname: 'Ana' });
  const { playerId, token } = union.data;
  assert.notEqual(playerId, 'player-socket');
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.deepEqual(union.jugador, { id: playerId, nickname: 'Ana', puntos: 0 });
  assert.equal(union.nuevo, true);
  assert.equal(union.data.pregunta, null);
  assert.deepEqual(service.iniciarJuego('host', { gamePin: '1234' }), { pin: '1234' });
  const pregunta = { titulo: 'Pregunta', opciones: ['A', 'B', 'C', 'D'] };
  const publicada = service.enviarPregunta('host', { gamePin: '1234', pregunta });
  assert.ok(publicada.preguntaId);
  assert.equal(publicada.cierraEn, 20789);
  pregunta.opciones[0] = 'Modificada';
  publicada.opciones[1] = 'Otra';
  assert.deepEqual(service.obtenerPartida('1234').preguntaActual.opciones, ['A', 'B', 'C', 'D']);
  assert.deepEqual(service.enviarRespuesta('player-socket', { gamePin: '1234', playerId }, {
    gamePin: '1234', preguntaId: publicada.preguntaId, respuestaSeleccionada: 1
  }), { data: { playerId, preguntaId: publicada.preguntaId, respuestaSeleccionada: 1 }, nuevo: true, totalAceptado: 1 });
});

test('un PIN ocupado se rechaza sin sobrescribir la partida', () => {
  const service = createGameService();
  service.crearPartida('host-1', { gamePin: '1234' });
  service.unirseAPartida('player', { gamePin: '1234', nickname: 'Ana' });
  assert.throws(() => service.crearPartida('host-2', { gamePin: '1234' }), { code: 'PIN_EN_USO' });
  assert.equal(service.obtenerPartida('1234').hostSocketId, 'host-1');
  assert.equal(service.obtenerPartida('1234').players.size, 1);
});

test('una partida inexistente no admite las operaciones existentes', () => {
  const service = createGameService();
  for (const operar of [
    () => service.unirseAPartida('player', { gamePin: '1234', nickname: 'Ana' }),
    () => service.iniciarJuego('host', { gamePin: '1234' }),
    () => service.enviarPregunta('host', { gamePin: '1234', pregunta: {} }),
    () => service.enviarRespuesta('player', {}, { gamePin: '1234' })
  ]) {
    assert.throws(operar, { code: 'PARTIDA_NO_EXISTE' });
  }
});

test('cerrar elimina las partidas y puede repetirse', () => {
  const service = createGameService();
  service.crearPartida('host', { gamePin: '1234' });
  const { data } = service.unirseAPartida('socket', { gamePin: '1234', nickname: 'Ana' });
  service.cerrar();
  service.cerrar();
  assert.throws(() => service.obtenerPartida('1234'), { code: 'PARTIDA_NO_EXISTE' });
  assert.throws(() => service.reanudarSesion('nuevo', { gamePin: '1234', token: data.token }), { code: 'SESION_INVALIDA' });
});

function prepararSesion(options) {
  const service = createGameService(options);
  service.crearPartida('host', { gamePin: '1234' });
  const { data } = service.unirseAPartida('socket-1', { gamePin: '1234', nickname: 'Ana' });
  service.iniciarJuego('host', { gamePin: '1234' });
  const pregunta = service.enviarPregunta('host', { gamePin: '1234', pregunta: { titulo: 'P', opciones: ['A', 'B', 'C', 'D'] } });
  const sesionActual = service.reanudarSesion('socket-1', { gamePin: '1234', token: data.token }).data;
  const identidad = { gamePin: '1234', playerId: data.playerId };
  const respuesta = { gamePin: '1234', preguntaId: pregunta.preguntaId, respuestaSeleccionada: 1 };
  return { service, data: sesionActual, identidad, respuesta };
}

test('la unión repetida devuelve identidad y token originales sin duplicar al jugador', () => {
  const { service, data } = prepararSesion();
  const repetida = service.unirseAPartida('socket-1', { gamePin: '1234', nickname: 'Otro nombre' });
  assert.equal(repetida.nuevo, false);
  assert.equal(repetida.jugador, undefined);
  assert.deepEqual(repetida.data, data);
  assert.equal(service.obtenerPartida('1234').players.size, 1);
});

test('dos sesiones pueden usar el mismo nick y reciben identidades distintas', () => {
  const { service, data } = prepararSesion();
  const otra = service.unirseAPartida('socket-2', { gamePin: '1234', nickname: 'Ana' }).data;
  assert.notEqual(otra.playerId, data.playerId);
  assert.notEqual(otra.token, data.token);
  assert.equal(service.obtenerPartida('1234').players.size, 2);
});

test('reconectar conserva identidad y pregunta sin duplicar el registro', () => {
  const { service, data, identidad, respuesta } = prepararSesion();
  const pregunta = service.enviarPregunta('host', { gamePin: '1234', pregunta: { titulo: 'P', opciones: ['A', 'B', 'C', 'D'] } });
  respuesta.preguntaId = pregunta.preguntaId;
  service.desconectar('socket-1');
  const reanudada = service.reanudarSesion('socket-2', { gamePin: '1234', token: data.token });
  assert.equal(reanudada.socketAnterior, null);
  assert.equal(reanudada.data.playerId, data.playerId);
  assert.equal(reanudada.data.token, data.token);
  assert.deepEqual(reanudada.data.pregunta, pregunta);
  reanudada.data.pregunta.opciones[0] = 'Modificada';
  assert.equal(service.obtenerPartida('1234').preguntaActual.opciones[0], 'A');
  assert.equal(service.obtenerPartida('1234').players.size, 1);
  assert.equal(service.enviarRespuesta('socket-2', identidad, respuesta).data.playerId, data.playerId);
  assert.equal(service.reanudarSesion('socket-2', { gamePin: '1234', token: data.token }).socketAnterior, null);
});

test('recuperar una sesión invalida la conexión anterior y su desconexión no invalida la nueva', () => {
  const { service, data, identidad, respuesta } = prepararSesion();
  const reanudada = service.reanudarSesion('socket-2', { gamePin: '1234', token: data.token });
  assert.equal(reanudada.socketAnterior, 'socket-1');
  assert.throws(() => service.enviarRespuesta('socket-1', identidad, respuesta), { code: 'SESION_INVALIDA' });
  assert.throws(() => service.unirseAPartida('socket-1', { gamePin: '1234', nickname: 'Ana' }), { code: 'SESION_INVALIDA' });
  service.desconectar('socket-1');
  service.desconectar('socket-1');
  assert.equal(service.enviarRespuesta('socket-2', identidad, respuesta).data.playerId, data.playerId);
});

test('tokens falsos o de otra partida no cambian la conexión activa', () => {
  const { service, data, identidad, respuesta } = prepararSesion();
  service.crearPartida('host-2', { gamePin: '5678' });
  for (const payload of [{ gamePin: '1234', token: '0'.repeat(64) }, { gamePin: '5678', token: data.token }]) {
    assert.throws(() => service.reanudarSesion('socket-2', payload), { code: 'SESION_INVALIDA' });
  }
  assert.equal(service.enviarRespuesta('socket-1', identidad, respuesta).data.playerId, data.playerId);
  assert.equal(service.obtenerPartida('1234').players.size, 1);
  assert.equal(service.obtenerPartida('5678').players.size, 0);
});

test('una conexión asociada no cambia de partida ni adopta otra sesión', () => {
  const { service, data, identidad, respuesta } = prepararSesion();
  service.crearPartida('host-2', { gamePin: '5678' });
  const otra = service.unirseAPartida('socket-2', { gamePin: '5678', nickname: 'Luis' }).data;
  assert.throws(() => service.unirseAPartida('socket-1', { gamePin: '5678', nickname: 'Ana' }), { code: 'SESION_INVALIDA' });
  assert.throws(() => service.reanudarSesion('socket-1', { gamePin: '5678', token: otra.token }), { code: 'SESION_INVALIDA' });
  assert.equal(service.enviarRespuesta('socket-1', identidad, respuesta).data.playerId, data.playerId);
  assert.equal(service.obtenerPartida('5678').players.size, 1);
});

test('responder exige conexión, asociación y registro coincidentes, no solo conocer el PIN', () => {
  const { service, data, identidad, respuesta } = prepararSesion();
  service.crearPartida('host-2', { gamePin: '5678' });
  assert.throws(() => service.enviarRespuesta('ajeno', identidad, respuesta), { code: 'NO_PERTENECE' });
  assert.throws(() => service.enviarRespuesta('socket-1', {}, respuesta), { code: 'NO_PERTENECE' });
  assert.throws(() => service.enviarRespuesta('socket-1', { ...identidad, playerId: 'inventado' }, respuesta), { code: 'NO_PERTENECE' });
  assert.throws(() => service.enviarRespuesta('socket-1', identidad, { ...respuesta, gamePin: '5678' }), { code: 'NO_PERTENECE' });
  service.obtenerPartida('1234').players.delete(data.playerId);
  assert.throws(() => service.enviarRespuesta('socket-1', identidad, respuesta), { code: 'NO_PERTENECE' });
});

const preguntaDePrueba = { titulo: 'Pregunta', opciones: ['A', 'B', 'C', 'D'] };

test('el ciclo pasa de lobby a en_curso y finalizada sin permitir reabrir la partida', (t) => {
  const clock = createManualClock();
  const service = createGameService(clock);
  t.after(() => service.cerrar());
  service.crearPartida('host', { gamePin: '1234' });
  const partida = service.obtenerPartida('1234');
  assert.equal(partida.estado, 'lobby');
  assert.equal(partida.preguntas.size, 0);
  assert.equal(partida.preguntaActual, null);
  const { data } = service.unirseAPartida('socket', { gamePin: '1234', nickname: 'Ana' });
  service.iniciarJuego('host', { gamePin: '1234' });
  assert.equal(partida.estado, 'en_curso');
  const pregunta = service.enviarPregunta('host', { gamePin: '1234', pregunta: preguntaDePrueba });
  service.iniciarJuego('host', { gamePin: '1234' });
  assert.equal(partida.preguntaActual.preguntaId, pregunta.preguntaId);
  service.finalizarPartida('host', { gamePin: '1234' });
  assert.throws(() => service.obtenerPartida('1234'), { code: 'PARTIDA_NO_EXISTE' });
  assert.equal(partida.estado, 'finalizada');
  assert.equal(partida.preguntaActual, null);
  assert.equal(clock.pending.size, 0);
  for (const operar of [
    () => service.iniciarJuego('host', { gamePin: '1234' }),
    () => service.enviarPregunta('host', { gamePin: '1234', pregunta: preguntaDePrueba }),
    () => service.unirseAPartida('otro', { gamePin: '1234', nickname: 'Luis' }),
    () => service.unirseAPartida('socket', { gamePin: '1234', nickname: 'Ana' }),
    () => service.enviarRespuesta('socket', { gamePin: '1234', playerId: data.playerId }, {
      gamePin: '1234', preguntaId: pregunta.preguntaId, respuestaSeleccionada: 0
    })
  ]) assert.throws(operar, { code: 'PARTIDA_NO_EXISTE' });
  assert.throws(() => service.reanudarSesion('otro', { gamePin: '1234', token: data.token }), { code: 'SESION_INVALIDA' });
});

test('solo el profesor propietario inicia, publica o finaliza sin alterar datos en rechazos', (t) => {
  const clock = createManualClock();
  const service = createGameService(clock);
  t.after(() => service.cerrar());
  service.crearPartida('host', { gamePin: '1234' });
  const partida = service.obtenerPartida('1234');
  assert.throws(() => service.iniciarJuego('ajeno', { gamePin: '1234' }), { code: 'NO_AUTORIZADO' });
  assert.equal(partida.estado, 'lobby');
  service.iniciarJuego('host', { gamePin: '1234' });
  service.enviarPregunta('host', { gamePin: '1234', pregunta: preguntaDePrueba });
  const activa = partida.preguntaActual;
  const timer = partida.temporizador;
  assert.throws(() => service.enviarPregunta('ajeno', { gamePin: '1234', pregunta: preguntaDePrueba }), { code: 'NO_AUTORIZADO' });
  assert.throws(() => service.finalizarPartida('ajeno', { gamePin: '1234' }), { code: 'NO_AUTORIZADO' });
  assert.equal(partida.preguntaActual, activa);
  assert.equal(partida.temporizador, timer);
  assert.equal(partida.preguntas.size, 1);
  assert.equal(partida.estado, 'en_curso');
});

test('publicar antes de iniciar se rechaza sin abrir preguntas ni programar temporizadores', () => {
  const clock = createManualClock();
  const service = createGameService(clock);
  service.crearPartida('host', { gamePin: '1234' });
  assert.throws(() => service.enviarPregunta('host', { gamePin: '1234', pregunta: preguntaDePrueba }), { code: 'JUEGO_NO_INICIADO' });
  assert.equal(service.obtenerPartida('1234').preguntas.size, 0);
  assert.equal(clock.pending.size, 0);
  service.cerrar();
});

test('cada pregunta conserva ID, tiempos y respuestas independientes con duración del servidor', (t) => {
  const clock = createManualClock();
  const { service, respuesta } = prepararSesion(clock);
  t.after(() => service.cerrar());
  const partida = service.obtenerPartida('1234');
  const primera = partida.preguntas.get(respuesta.preguntaId);
  assert.equal(primera.abiertaEn, 1000);
  assert.equal(primera.cierraEn, 1000 + CONFIG.questionDurationMs);
  assert.ok(primera.respuestas instanceof Map);
  clock.advanceTo(2000);
  const nueva = service.enviarPregunta('host', {
    gamePin: '1234', cierraEn: Infinity,
    pregunta: { ...preguntaDePrueba, preguntaId: 'cliente', cierraEn: Infinity }
  });
  assert.notEqual(nueva.preguntaId, primera.preguntaId);
  assert.notEqual(nueva.preguntaId, 'cliente');
  assert.equal(nueva.cierraEn, 2000 + CONFIG.questionDurationMs);
  assert.equal(primera.abierta, false);
  assert.equal(partida.preguntas.size, 2);
  assert.notEqual(primera.respuestas, partida.preguntaActual.respuestas);
  assert.equal(clock.pending.size, 1);
  assert.equal(clock.scheduled.at(-1).delay, CONFIG.questionDurationMs);
  assert.deepEqual(Object.keys(nueva).sort(), ['cierraEn', 'opciones', 'preguntaId', 'titulo']);
});

test('responder antes del inicio o sin pregunta activa se rechaza', () => {
  const service = createGameService();
  service.crearPartida('host', { gamePin: '1234' });
  const { data } = service.unirseAPartida('socket', { gamePin: '1234', nickname: 'Ana' });
  const responder = () => service.enviarRespuesta('socket', { gamePin: '1234', playerId: data.playerId }, {
    gamePin: '1234', preguntaId: 'inventada', respuestaSeleccionada: 0
  });
  assert.throws(responder, { code: 'SIN_PREGUNTA_ACTIVA' });
  service.iniciarJuego('host', { gamePin: '1234' });
  assert.throws(responder, { code: 'SIN_PREGUNTA_ACTIVA' });
  service.cerrar();
});

test('la ventana exige apertura <= ahora < cierre aunque el temporizador se retrase', async (t) => {
  for (const [time, code] of [
    [999, 'PLAZO_CERRADO'], [1000, null], [20999, null], [21000, 'PLAZO_CERRADO'], [21001, 'PLAZO_CERRADO']
  ]) {
    await t.test(`reloj ${time}`, () => {
      const clock = createManualClock();
      const { service, identidad, respuesta } = prepararSesion(clock);
      clock.advanceTo(time);
      const responder = () => service.enviarRespuesta('socket-1', identidad, { ...respuesta, cierraEn: Infinity });
      if (code) assert.throws(responder, { code });
      else assert.equal(responder().data.preguntaId, respuesta.preguntaId);
      assert.equal(service.obtenerPartida('1234').preguntaActual.respuestas.size, code ? 0 : 1);
      service.cerrar();
    });
  }
});

test('los IDs antiguos o desconocidos se rechazan y no afectan a la pregunta activa', (t) => {
  const { service, identidad, respuesta } = prepararSesion(createManualClock());
  t.after(() => service.cerrar());
  const nueva = service.enviarPregunta('host', { gamePin: '1234', pregunta: preguntaDePrueba });
  for (const preguntaId of [respuesta.preguntaId, 'desconocida']) {
    assert.throws(() => service.enviarRespuesta('socket-1', identidad, { ...respuesta, preguntaId }), { code: 'PREGUNTA_INCORRECTA' });
  }
  assert.equal(service.obtenerPartida('1234').preguntaActual.preguntaId, nueva.preguntaId);
  assert.equal(service.obtenerPartida('1234').preguntaActual.respuestas.size, 0);
});

test('el temporizador cierra y notifica una sola vez después de guardar el cierre', (t) => {
  const clock = createManualClock();
  const notificaciones = [];
  const { service, identidad, respuesta } = prepararSesion({
    ...clock,
    onQuestionClosed(pin, data) {
      assert.equal(service.obtenerPartida(pin).preguntaActual.abierta, false);
      notificaciones.push({ pin, ...data });
    }
  });
  t.after(() => service.cerrar());
  const timer = clock.scheduled[0];
  clock.advanceTo(21000);
  clock.fire(timer);
  clock.fire(timer);
  assert.deepEqual(notificaciones, [{ pin: '1234', preguntaId: respuesta.preguntaId }]);
  assert.equal(clock.pending.size, 0);
  assert.equal(service.obtenerPartida('1234').temporizador, null);
  assert.throws(() => service.enviarRespuesta('socket-1', identidad, respuesta), { code: 'PLAZO_CERRADO' });
});

test('un callback adelantado se reprograma sin cerrar antes del plazo', (t) => {
  const clock = createManualClock();
  const notificaciones = [];
  const { service } = prepararSesion({ ...clock, onQuestionClosed: (...args) => notificaciones.push(args) });
  t.after(() => service.cerrar());
  clock.advanceTo(20000);
  clock.fire(clock.scheduled[0]);
  assert.equal(service.obtenerPartida('1234').preguntaActual.abierta, true);
  assert.equal(clock.scheduled.at(-1).delay, 1000);
  assert.equal(clock.pending.size, 1);
  assert.equal(notificaciones.length, 0);
  clock.advanceTo(21000);
  clock.fire(clock.scheduled.at(-1));
  assert.equal(notificaciones.length, 1);
});

test('un temporizador sustituido no cierra la pregunta nueva ni cancela su temporizador', (t) => {
  const clock = createManualClock();
  const notificaciones = [];
  const { service } = prepararSesion({ ...clock, onQuestionClosed: (...args) => notificaciones.push(args) });
  t.after(() => service.cerrar());
  const anterior = clock.scheduled[0];
  clock.advanceTo(2000);
  const nueva = service.enviarPregunta('host', { gamePin: '1234', pregunta: preguntaDePrueba });
  const actual = clock.scheduled.at(-1);
  assert.equal(clock.pending.has(anterior), false);
  clock.advanceTo(21000);
  clock.fire(anterior);
  assert.equal(service.obtenerPartida('1234').preguntaActual.abierta, true);
  assert.equal(clock.pending.has(actual), true);
  assert.equal(notificaciones.length, 0);
  clock.advanceTo(nueva.cierraEn);
  clock.fire(actual);
  assert.deepEqual(notificaciones, [['1234', { preguntaId: nueva.preguntaId }]]);
});

test('cerrar cancela todos los temporizadores y callbacks antiguos no afectan un PIN reutilizado', () => {
  const clock = createManualClock();
  const notificaciones = [];
  const { service } = prepararSesion({ ...clock, onQuestionClosed: (...args) => notificaciones.push(args) });
  const partida = service.obtenerPartida('1234');
  service.crearPartida('otro-host', { gamePin: '5678' });
  service.iniciarJuego('otro-host', { gamePin: '5678' });
  service.enviarPregunta('otro-host', { gamePin: '5678', pregunta: preguntaDePrueba });
  const anteriores = [...clock.pending];
  service.cerrar();
  service.cerrar();
  assert.equal(partida.estado, 'finalizada');
  assert.equal(clock.pending.size, 0);
  clock.advanceTo(30000);
  anteriores.forEach(clock.fire);
  service.crearPartida('nuevo-host', { gamePin: '1234' });
  service.iniciarJuego('nuevo-host', { gamePin: '1234' });
  service.enviarPregunta('nuevo-host', { gamePin: '1234', pregunta: preguntaDePrueba });
  anteriores.forEach(clock.fire);
  assert.equal(notificaciones.length, 0);
  assert.equal(service.obtenerPartida('1234').preguntaActual.abierta, true);
  assert.equal(clock.pending.size, 1);
  service.cerrar();
});

test('recuperar al vencer el plazo devuelve pregunta cerrada incluso con el callback pendiente', (t) => {
  const clock = createManualClock();
  const { service, data, respuesta } = prepararSesion(clock);
  t.after(() => service.cerrar());
  assert.equal(data.preguntaAbierta, true);
  clock.advanceTo(21000);
  service.desconectar('socket-1');
  const recuperada = service.reanudarSesion('socket-2', { gamePin: '1234', token: data.token }).data;
  assert.equal(recuperada.estado, 'en_curso');
  assert.equal(recuperada.preguntaAbierta, false);
  assert.equal(recuperada.pregunta.preguntaId, respuesta.preguntaId);
  assert.equal(recuperada.pregunta.cierraEn, 21000);
  assert.equal(clock.pending.size, 1);
  assert.equal(recuperada.pregunta.respuestas, undefined);
});

test('opciones de otro tipo o fuera del rango se rechazan sin registrar respuestas', () => {
  const { service, identidad, respuesta } = prepararSesion(createManualClock());
  const pregunta = service.obtenerPartida('1234').preguntaActual;
  for (const respuestaSeleccionada of [undefined, null, false, '0', [], {}, 0.5, -1, 4, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => service.enviarRespuesta('socket-1', identidad, { ...respuesta, respuestaSeleccionada }), { code: 'OPCION_INVALIDA' });
    assert.equal(pregunta.respuestas.size, 0);
  }
  for (const respuestaSeleccionada of [0, 3]) {
    const { data } = service.unirseAPartida(`socket-${respuestaSeleccionada}`, { gamePin: '1234', nickname: 'Otro' });
    const aceptada = service.enviarRespuesta(`socket-${respuestaSeleccionada}`, { gamePin: '1234', playerId: data.playerId }, {
      ...respuesta, respuestaSeleccionada
    });
    assert.equal(aceptada.data.respuestaSeleccionada, respuestaSeleccionada);
  }
  assert.equal(pregunta.respuestas.size, 2);
});

test('la respuesta queda guardada antes de devolver la aceptación y no comparte objetos con el caller', () => {
  const { service, data, identidad, respuesta } = prepararSesion(createManualClock());
  const aceptada = service.enviarRespuesta('socket-1', identidad, respuesta);
  const registros = service.obtenerPartida('1234').preguntaActual.respuestas;
  assert.deepEqual(registros.get(data.playerId), aceptada.data);
  assert.equal(aceptada.nuevo, true);
  assert.equal(aceptada.totalAceptado, 1);
  respuesta.respuestaSeleccionada = 2;
  aceptada.data.respuestaSeleccionada = 3;
  const repetida = service.enviarRespuesta('socket-1', identidad, { ...respuesta, respuestaSeleccionada: 1 });
  assert.equal(repetida.data.respuestaSeleccionada, 1);
  repetida.data.respuestaSeleccionada = 0;
  assert.equal(registros.get(data.playerId).respuestaSeleccionada, 1);
});

test('repetir la misma opción conserva la aceptación aunque otros jugadores hayan respondido', () => {
  const { service, identidad, respuesta } = prepararSesion(createManualClock());
  const primera = service.enviarRespuesta('socket-1', identidad, respuesta);
  const { data: otro } = service.unirseAPartida('socket-2', { gamePin: '1234', nickname: 'Ana' });
  const segunda = service.enviarRespuesta('socket-2', { gamePin: '1234', playerId: otro.playerId }, respuesta);
  const repetida = service.enviarRespuesta('socket-1', identidad, respuesta);
  assert.deepEqual(repetida.data, primera.data);
  assert.equal(repetida.nuevo, false);
  assert.equal(primera.totalAceptado, 1);
  assert.equal(segunda.totalAceptado, 2);
  assert.equal(repetida.totalAceptado, 2);
  assert.equal(service.obtenerPartida('1234').preguntaActual.respuestas.size, 2);
});

test('un reintento idéntico tras el cierre confirma y un cambio de opción devuelve YA_RESPONDIO', () => {
  const clock = createManualClock();
  const { service, identidad, respuesta } = prepararSesion(clock);
  const primera = service.enviarRespuesta('socket-1', identidad, respuesta);
  assert.throws(() => service.enviarRespuesta('socket-1', identidad, { ...respuesta, respuestaSeleccionada: 2 }), { code: 'YA_RESPONDIO' });
  clock.advanceTo(21000);
  clock.fire(clock.scheduled[0]);
  const repetida = service.enviarRespuesta('socket-1', identidad, respuesta);
  assert.deepEqual(repetida.data, primera.data);
  assert.equal(repetida.nuevo, false);
  assert.throws(() => service.enviarRespuesta('socket-1', identidad, { ...respuesta, respuestaSeleccionada: 2 }), { code: 'YA_RESPONDIO' });
  assert.throws(() => service.enviarRespuesta('socket-1', identidad, { ...respuesta, respuestaSeleccionada: 4 }), { code: 'OPCION_INVALIDA' });
  assert.equal(service.obtenerPartida('1234').preguntaActual.respuestas.size, 1);
});

test('la deduplicación conserva preguntas anteriores y permite responder de nuevo en otra pregunta', () => {
  const { service, identidad, respuesta } = prepararSesion(createManualClock());
  const primera = service.enviarRespuesta('socket-1', identidad, respuesta);
  const partida = service.obtenerPartida('1234');
  const preguntaAnterior = partida.preguntaActual;
  const nueva = service.enviarPregunta('host', { gamePin: '1234', pregunta: preguntaDePrueba });
  assert.equal(service.enviarRespuesta('socket-1', identidad, respuesta).nuevo, false);
  assert.deepEqual(service.enviarRespuesta('socket-1', identidad, respuesta).data, primera.data);
  assert.throws(() => service.enviarRespuesta('socket-1', identidad, { ...respuesta, respuestaSeleccionada: 0 }), { code: 'YA_RESPONDIO' });
  const { data: otro } = service.unirseAPartida('socket-2', { gamePin: '1234', nickname: 'Luis' });
  assert.throws(() => service.enviarRespuesta('socket-2', { gamePin: '1234', playerId: otro.playerId }, respuesta), { code: 'PREGUNTA_INCORRECTA' });
  const segunda = service.enviarRespuesta('socket-1', identidad, { ...respuesta, preguntaId: nueva.preguntaId, respuestaSeleccionada: 3 });
  assert.equal(segunda.nuevo, true);
  assert.equal(segunda.totalAceptado, 1);
  assert.equal(preguntaAnterior.respuestas.size, 1);
  assert.equal(partida.preguntaActual.respuestas.size, 1);
  assert.equal(preguntaAnterior.respuestas.get(identidad.playerId).respuestaSeleccionada, 1);
  assert.equal(partida.preguntaActual.respuestas.get(identidad.playerId).respuestaSeleccionada, 3);
});

test('la aceptación previa no evita comprobar pertenencia, sesión ni opción válida', () => {
  const { service, identidad, respuesta } = prepararSesion(createManualClock());
  service.enviarRespuesta('socket-1', identidad, respuesta);
  service.crearPartida('host-2', { gamePin: '5678' });
  assert.throws(() => service.enviarRespuesta('ajeno', identidad, respuesta), { code: 'NO_PERTENECE' });
  assert.throws(() => service.enviarRespuesta('socket-1', { ...identidad, playerId: 'inventado' }, respuesta), { code: 'NO_PERTENECE' });
  assert.throws(() => service.enviarRespuesta('socket-1', identidad, { ...respuesta, gamePin: '5678' }), { code: 'NO_PERTENECE' });
  for (const respuestaSeleccionada of ['1', 0.5, -1, 4]) {
    assert.throws(() => service.enviarRespuesta('socket-1', identidad, { ...respuesta, respuestaSeleccionada }), { code: 'OPCION_INVALIDA' });
  }
  assert.equal(service.obtenerPartida('1234').preguntaActual.respuestas.size, 1);
});

test('desconectar y reanudar conserva respuestas y revoca los reintentos de la conexión anterior', () => {
  const clock = createManualClock();
  const { service, data, identidad, respuesta } = prepararSesion(clock);
  const primera = service.enviarRespuesta('socket-1', identidad, respuesta);
  service.desconectar('socket-1');
  assert.equal(service.obtenerPartida('1234').preguntaActual.respuestas.size, 1);
  service.reanudarSesion('socket-2', { gamePin: '1234', token: data.token });
  clock.advanceTo(21000);
  const reintento = service.enviarRespuesta('socket-2', identidad, respuesta);
  assert.deepEqual(reintento.data, primera.data);
  assert.equal(reintento.nuevo, false);
  assert.throws(() => service.enviarRespuesta('socket-2', identidad, { ...respuesta, respuestaSeleccionada: 2 }), { code: 'YA_RESPONDIO' });
  assert.throws(() => service.enviarRespuesta('socket-1', identidad, respuesta), { code: 'NO_PERTENECE' });
  service.reanudarSesion('socket-3', { gamePin: '1234', token: data.token });
  assert.throws(() => service.enviarRespuesta('socket-2', identidad, respuesta), { code: 'SESION_INVALIDA' });
  assert.equal(service.enviarRespuesta('socket-3', identidad, respuesta).nuevo, false);
});

test('finalizar una partida impide confirmar de nuevo una aceptación anterior', () => {
  const { service, identidad, respuesta } = prepararSesion(createManualClock());
  service.enviarRespuesta('socket-1', identidad, respuesta);
  service.finalizarPartida('host', { gamePin: '1234' });
  assert.throws(() => service.enviarRespuesta('socket-1', identidad, respuesta), { code: 'PARTIDA_NO_EXISTE' });
});

test('consultar y reanudar devuelven solo la respuesta del jugador con el plazo del servidor', () => {
  const clock = createManualClock();
  const { service, data, identidad, respuesta } = prepararSesion(clock);
  const inicial = service.consultarEstado('socket-1', identidad, { gamePin: '1234' });
  assert.equal(inicial.respuesta, null);
  assert.equal(inicial.preguntaAbierta, true);
  assert.equal(inicial.token, undefined);
  const aceptada = service.enviarRespuesta('socket-1', identidad, respuesta).data;
  const estado = service.consultarEstado('socket-1', identidad, { gamePin: '1234' });
  assert.deepEqual(estado.respuesta, aceptada);
  estado.respuesta.respuestaSeleccionada = 3;
  estado.pregunta.opciones[0] = 'Modificada';
  assert.deepEqual(service.consultarEstado('socket-1', identidad, { gamePin: '1234' }).respuesta, aceptada);
  const { data: otro } = service.unirseAPartida('socket-2', { gamePin: '1234', nickname: 'Luis' });
  assert.equal(service.consultarEstado('socket-2', { gamePin: '1234', playerId: otro.playerId }, { gamePin: '1234' }).respuesta, null);
  clock.advanceTo(inicial.pregunta.cierraEn);
  const recuperada = service.reanudarSesion('socket-3', { gamePin: '1234', token: data.token });
  assert.deepEqual(recuperada.data.respuesta, aceptada);
  assert.equal(recuperada.data.preguntaAbierta, false);
  assert.throws(() => service.consultarEstado('socket-1', identidad, { gamePin: '1234' }), { code: 'SESION_INVALIDA' });
});

test('consultar devuelve null en lobby y exige una sesión de la partida solicitada', () => {
  const service = createGameService();
  service.crearPartida('host', { gamePin: '1234' });
  service.crearPartida('otro-host', { gamePin: '5678' });
  const { data } = service.unirseAPartida('socket', { gamePin: '1234', nickname: 'Ana' });
  const identidad = { gamePin: '1234', playerId: data.playerId };
  assert.deepEqual(service.consultarEstado('socket', identidad, { gamePin: '1234' }), {
    pin: '1234', estado: 'lobby', pregunta: null, preguntaAbierta: false, respuesta: null
  });
  assert.throws(() => service.consultarEstado('ajeno', identidad, { gamePin: '1234' }), { code: 'NO_PERTENECE' });
  assert.throws(() => service.consultarEstado('socket', identidad, { gamePin: '5678' }), { code: 'NO_PERTENECE' });
});

test('desconectar al profesor elimina todas sus partidas y recursos sin afectar a otro profesor', () => {
  const clock = createManualClock();
  const notificaciones = [];
  const { service, data, identidad, respuesta } = prepararSesion({ ...clock, onQuestionClosed: (...args) => notificaciones.push(args) });
  service.enviarRespuesta('socket-1', identidad, respuesta);
  service.reanudarSesion('socket-2', { gamePin: '1234', token: data.token });
  service.desconectar('socket-2');
  const partida = service.obtenerPartida('1234');
  const pregunta = partida.preguntaActual;
  const timer = partida.temporizador;
  service.crearPartida('host', { gamePin: '2345' });
  service.crearPartida('otro-host', { gamePin: '5678' });
  service.iniciarJuego('otro-host', { gamePin: '5678' });
  service.enviarPregunta('otro-host', { gamePin: '5678', pregunta: preguntaDePrueba });
  assert.deepEqual(service.desconectarProfesor('host'), [{ pin: '1234' }, { pin: '2345' }]);
  assert.deepEqual(service.desconectarProfesor('host'), []);
  assert.equal(partida.estado, 'finalizada');
  assert.equal(partida.players.size, 0);
  assert.equal(partida.preguntas.size, 0);
  assert.equal(pregunta.respuestas.size, 0);
  assert.equal(partida.temporizador, null);
  assert.equal(clock.pending.size, 1);
  assert.throws(() => service.reanudarSesion('socket-3', { gamePin: '1234', token: data.token }), { code: 'SESION_INVALIDA' });
  // La conexión revocada también debe quedar libre de la asociación antigua.
  assert.equal(service.unirseAPartida('socket-1', { gamePin: '5678', nickname: 'Ana' }).nuevo, true);
  clock.advanceTo(22000);
  clock.fire(timer);
  assert.deepEqual(notificaciones, []);
  assert.equal(service.obtenerPartida('5678').estado, 'en_curso');
});
