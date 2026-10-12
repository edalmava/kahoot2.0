const express = require('express');
const { createServer: createHttpServer } = require('node:http');
const { Server } = require('socket.io');
const path = require('node:path');
const { CONFIG, CLIENT_CONFIG } = require('./src/config');
const { createGameService } = require('./src/game-service');
const { registerRequest } = require('./src/request-handler');
const { validarPartida, validarUnion, validarPregunta, validarRespuesta, validarReanudacion } = require('./src/validators');

function createGameServer({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, logger = console } = {}) {
  const app = express();
  const httpServer = createHttpServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });
  const hostNamespace = io.of('/host');
  const playerNamespace = io.of('/player');
  const gameService = createGameService({
    now, setTimer, clearTimer,
    onQuestionClosed(gamePin, data) {
      playerNamespace.to(gamePin).emit('pregunta_cerrada', data);
      hostNamespace.to(gamePin).emit('pregunta_cerrada', data);
    }
  });

  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/host-panel', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'host.html'));
  });
  app.get('/play', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'player.html'));
  });

  hostNamespace.on('connection', (socket) => {
    socket.emit('configuracion', CLIENT_CONFIG);

    registerRequest(socket, 'crear_partida', validarPartida, async (payload) => {
      const data = gameService.crearPartida(socket.id, payload);
      await socket.join(payload.gamePin);
      return data;
    }, logger);

    registerRequest(socket, 'iniciar_juego', validarPartida, (payload) => {
      const data = gameService.iniciarJuego(socket.id, payload);
      playerNamespace.to(payload.gamePin).emit('juego_iniciado', data);
      return data;
    }, logger);

    registerRequest(socket, 'enviar_pregunta', validarPregunta, (payload) => {
      const pregunta = gameService.enviarPregunta(socket.id, payload);
      hostNamespace.to(payload.gamePin).emit('recibir_pregunta', pregunta);
      playerNamespace.to(payload.gamePin).emit('recibir_pregunta', pregunta);
      return pregunta;
    }, logger);

    socket.on('disconnect', () => {
      for (const { pin } of gameService.desconectarProfesor(socket.id)) {
        playerNamespace.to(pin).emit('partida_finalizada', { pin, motivo: 'El profesor se desconectó. La partida ha terminado.' });
        for (const playerId of playerNamespace.adapter.rooms.get(pin) || []) {
          const player = playerNamespace.sockets.get(playerId);
          if (player) {
            delete player.data.playerId;
            delete player.data.gamePin;
          }
        }
        playerNamespace.in(pin).socketsLeave(pin);
      }
    });
  });

  playerNamespace.on('connection', (socket) => {
    socket.emit('configuracion', CLIENT_CONFIG);

    async function asociarSesion(data) {
      socket.data.playerId = data.playerId;
      socket.data.gamePin = data.pin;
      await socket.join(data.pin);
    }

    registerRequest(socket, 'unirse_a_partida', validarUnion, async (payload) => {
      const { data, jugador, nuevo } = gameService.unirseAPartida(socket.id, payload);
      await asociarSesion(data);
      if (nuevo) hostNamespace.to(data.pin).emit('nuevo_jugador', jugador);
      return data;
    }, logger);

    registerRequest(socket, 'reanudar_sesion', validarReanudacion, async (payload) => {
      const { data, socketAnterior } = gameService.reanudarSesion(socket.id, payload);
      if (socketAnterior) {
        const anterior = playerNamespace.sockets.get(socketAnterior);
        if (anterior) {
          delete anterior.data.playerId;
          delete anterior.data.gamePin;
          anterior.emit('sesion_reemplazada', { message: 'La sesión se abrió en otra conexión.' });
          anterior.disconnect();
        }
      }
      await asociarSesion(data);
      return data;
    }, logger);

    registerRequest(socket, 'enviar_respuesta', validarRespuesta, (payload) => {
      const { data, nuevo, totalAceptado } = gameService.enviarRespuesta(socket.id, socket.data, payload);
      if (nuevo) {
        hostNamespace.to(payload.gamePin).emit('respuesta_recibida', {
          playerId: data.playerId,
          preguntaId: data.preguntaId,
          respuesta: data.respuestaSeleccionada,
          totalAceptado
        });
      }
      return data;
    }, logger);

    registerRequest(socket, 'consultar_estado', validarPartida, (payload) => {
      return gameService.consultarEstado(socket.id, socket.data, payload);
    }, logger);

    socket.on('disconnect', () => {
      gameService.desconectar(socket.id);
    });
  });

  let cierre;
  function close() {
    if (!cierre) {
      gameService.cerrar();
      cierre = io.close();
    }
    return cierre;
  }

  return { app, httpServer, io, gameService, close };
}

if (require.main === module) {
  const server = createGameServer();
  server.httpServer.listen(CONFIG.port, () => {
    console.log(`Servidor Kahoot listo en puerto ${CONFIG.port}`);
    console.log(`Profesor: http://localhost:${CONFIG.port}/host-panel`);
    console.log(`Jugador: http://localhost:${CONFIG.port}/play`);
  });
}

module.exports = { createGameServer };
