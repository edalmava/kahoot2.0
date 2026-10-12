const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGameService } = require('../src/game-service');

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
  assert.deepEqual(service.unirseAPartida('player', { gamePin: '1234', nickname: 'Ana' }), {
    pin: '1234', jugador: { id: 'player', nickname: 'Ana', puntos: 0 }
  });
  assert.deepEqual(service.iniciarJuego({ gamePin: '1234' }), { pin: '1234' });
  const pregunta = { titulo: 'Pregunta', opciones: ['A', 'B', 'C', 'D'] };
  const publicada = service.enviarPregunta({ gamePin: '1234', pregunta });
  assert.ok(publicada.preguntaId);
  assert.equal(publicada.publicadaEn, 789);
  pregunta.opciones[0] = 'Modificada';
  publicada.opciones[1] = 'Otra';
  assert.deepEqual(service.obtenerPartida('1234').preguntaActual.opciones, ['A', 'B', 'C', 'D']);
  assert.deepEqual(service.enviarRespuesta('player', {
    gamePin: '1234', preguntaId: publicada.preguntaId, respuestaSeleccionada: 1
  }), { playerId: 'player', preguntaId: publicada.preguntaId, respuestaSeleccionada: 1 });
});

test('un PIN ocupado se rechaza sin sobrescribir la partida', () => {
  const service = createGameService();
  service.crearPartida('host-1', { gamePin: '1234' });
  service.unirseAPartida('player', { gamePin: '1234', nickname: 'Ana' });
  assert.throws(() => service.crearPartida('host-2', { gamePin: '1234' }), { code: 'PIN_EN_USO' });
  assert.equal(service.obtenerPartida('1234').hostSocketId, 'host-1');
  assert.equal(service.obtenerPartida('1234').players.length, 1);
});

test('una partida inexistente no admite las operaciones existentes', () => {
  const service = createGameService();
  for (const operar of [
    () => service.unirseAPartida('player', { gamePin: '1234', nickname: 'Ana' }),
    () => service.iniciarJuego({ gamePin: '1234' }),
    () => service.enviarPregunta({ gamePin: '1234', pregunta: {} }),
    () => service.enviarRespuesta('player', { gamePin: '1234' })
  ]) {
    assert.throws(operar, { code: 'PARTIDA_NO_EXISTE' });
  }
});

test('cerrar elimina las partidas y puede repetirse', () => {
  const service = createGameService();
  service.crearPartida('host', { gamePin: '1234' });
  service.cerrar();
  service.cerrar();
  assert.throws(() => service.obtenerPartida('1234'), { code: 'PARTIDA_NO_EXISTE' });
});
