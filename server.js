const express = require('express');
const { createServer: createHttpServer } = require('node:http');
const { Server } = require('socket.io');
const path = require('node:path');
const { CONFIG, CLIENT_CONFIG } = require('./src/config');
const { createGameService } = require('./src/game-service');
const { registerRequest } = require('./src/request-handler');
const { validarPartida, validarUnion, validarPregunta, validarRespuesta } = require('./src/validators');

function createGameServer({ now = Date.now, logger = console } = {}) {
  const app = express();
  const httpServer = createHttpServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });
  const gameService = createGameService({ now });
  const hostNamespace = io.of('/host');
  const playerNamespace = io.of('/player');

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
      const data = gameService.iniciarJuego(payload);
      playerNamespace.to(payload.gamePin).emit('juego_iniciado', data);
      return data;
    }, logger);

    registerRequest(socket, 'enviar_pregunta', validarPregunta, (payload) => {
      const pregunta = gameService.enviarPregunta(payload);
      playerNamespace.to(payload.gamePin).emit('recibir_pregunta', pregunta);
      return pregunta;
    }, logger);
  });

  playerNamespace.on('connection', (socket) => {
    socket.emit('configuracion', CLIENT_CONFIG);

    registerRequest(socket, 'unirse_a_partida', validarUnion, async (payload) => {
      const { pin, jugador } = gameService.unirseAPartida(socket.id, payload);
      await socket.join(payload.gamePin);
      hostNamespace.to(payload.gamePin).emit('nuevo_jugador', jugador);
      return { pin };
    }, logger);

    registerRequest(socket, 'enviar_respuesta', validarRespuesta, (payload) => {
      const data = gameService.enviarRespuesta(socket.id, payload);
      hostNamespace.to(payload.gamePin).emit('respuesta_recibida', {
        playerId: data.playerId,
        preguntaId: data.preguntaId,
        respuesta: data.respuestaSeleccionada
      });
      return data;
    }, logger);
  });

  let cierre;
  function close() {
    if (!cierre) {
      cierre = io.close().finally(() => gameService.cerrar());
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
