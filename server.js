const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" } // Ajusta según tus necesidades
});

// ==========================================
// 1. CONFIGURACIÓN DE EXPRESS (Rutas y Estáticos)
// ==========================================

// Le decimos a Express que busque archivos en la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Ruta para la pantalla del Profesor (Host)
app.get('/host-panel', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

// Ruta para la pantalla del Alumno (Player)
app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

// ==========================================
// 2. LÓGICA DE CONTROL (Base de datos en memoria)
// ==========================================

// Guardaremos el estado de los juegos activos en memoria (para producción usa Redis)
// Estructura: { "PIN_1234": { hostId: "...", players: [...], preguntaActual: 0 } }
const partidasActivas = new Map();

// ==========================================
// 3. NAMESPACE PARA LOS HOSTS (Profesores)
// ==========================================
const hostNamespace = io.of("/host");

hostNamespace.on("connection", (socket) => {
  console.log(`Host conectado: ${socket.id}`);

  // El host crea una nueva partida y genera un PIN único
  socket.on("crear_partida", (gamePin) => {
    socket.join(gamePin); // El host se une a la Room de su propio juego
    
    partidasActivas.set(gamePin, {
      hostSocketId: socket.id,
      players: []
    });
    
    console.log(`Partida creada con el PIN: ${gamePin}`);
    socket.emit("partida_creada", { status: "success", pin: gamePin });
  });

  // El host inicia el juego y manda la primera pregunta
  socket.on("iniciar_juego", (gamePin) => {
    // Le avisamos a todos los PLAYERS en esa Room que el juego comenzó
    playerNamespace.to(gamePin).emit("juego_iniciado");
  });

  // El host envía una pregunta a los jugadores
  socket.on("enviar_pregunta", ({ gamePin, pregunta }) => {
    // Enviamos solo las opciones de respuesta a los jugadores (sin la respuesta correcta)
    playerNamespace.to(gamePin).emit("recibir_pregunta", {
      titulo: pregunta.titulo,
      opciones: pregunta.opciones // Ej: ['A', 'B', 'C', 'D']
    });
  });
});

// ==========================================
// 4. NAMESPACE PARA LOS PLAYERS (Alumnos)
// ==========================================
const playerNamespace = io.of("/player");

playerNamespace.on("connection", (socket) => {
  console.log(`Jugador conectado: ${socket.id}`);

  // El jugador intenta unirse usando el PIN y su nombre
  socket.on("unirse_a_partida", ({ gamePin, nickname }) => {
    // Verificar si la partida existe en el mapa global
    if (!partidasActivas.has(gamePin)) {
      return socket.emit("error_union", "La partida no existe o ha terminado.");
    }

    // Unimos al jugador a la Room del juego
    socket.join(gamePin);

    // Guardamos al jugador en el estado de la partida
    const partida = partidasActivas.get(gamePin);
    partida.players.push({ id: socket.id, nickname, puntos: 0 });

    // LE AVISAMOS AL HOST (en su namespace) que entró un nuevo jugador para que lo pinte en pantalla
    hostNamespace.to(gamePin).emit("nuevo_jugador", { nickname, id: socket.id });

    // Confirmamos al jugador que ya está dentro de la sala de espera
    socket.emit("union_exitosa", { pin: gamePin });
  });

  // El jugador envía su respuesta
  socket.on("enviar_respuesta", ({ gamePin, respuestaSeleccionada }) => {
    const partida = partidasActivas.get(gamePin);
    if (!partida) return;

    // Enviamos la respuesta directamente al HOST para que calcule los puntos
    hostNamespace.to(gamePin).emit("respuesta_recibida", {
      playerId: socket.id,
      respuesta: respuestaSeleccionada
    });
  });
});

// ==========================================
// 5. ENCENDIDO DEL SERVIDOR
// ==========================================

const PUERTO = 3000;

httpServer.listen(3000, () => {
  console.log("Servidor Kahoot Clone corriendo en puerto 3000");
  console.log(`\n🚀 ¡Servidor Kahoot listo!`);
  console.log(`💻 Profesor ingresa a: http://localhost:${PUERTO}/host-panel`);
  console.log(`📱 Alumno ingresa a:   http://localhost:${PUERTO}/play\n`);
});