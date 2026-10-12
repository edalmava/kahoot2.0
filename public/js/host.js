// Nos conectamos ESTRICTAMENTE al namespace '/host'
const socket = io("/host"); 

let miPin = "";
let conteoRespuestas = 0;

// Elementos del DOM
const pInicio = document.getElementById("pantalla-inicio");
const pLobby = document.getElementById("pantalla-lobby");
const pJuego = document.getElementById("pantalla-juego");

// Crear partida de forma aleatoria
document.getElementById("btn-crear").addEventListener("click", () => {
  miPin = Math.floor(1000 + Math.random() * 9000).toString(); // PIN de 4 dígitos
  socket.emit("crear_partida", miPin);
});

// Confirmación de sala creada
socket.on("partida_creada", (data) => {
  pInicio.style.display = "none";
  pLobby.style.display = "block";
  document.getElementById("mostrar-pin").innerText = data.pin;
});

// Escuchar cuando entra un alumno (desde el otro namespace)
socket.on("nuevo_jugador", (jugador) => {
  const lista = document.getElementById("lista-jugadores");
  const li = document.createElement("li");
  li.innerText = jugador.nickname;
  lista.appendChild(li);
  
  const contador = document.getElementById("contador");
  contador.innerText = parseInt(contador.innerText) + 1;
});

// Botón para iniciar la partida
document.getElementById("btn-comenzar").addEventListener("click", () => {
  socket.emit("iniciar_juego", miPin);
  
  // Simulamos lanzar la primera pregunta inmediatamente
  pLobby.style.display = "none";
  pJuego.style.display = "block";
  
  const preguntaFake = {
    titulo: "¿Cuál es el protocolo nativo de Socket.IO?",
    opciones: ["HTTP", "WebSockets", "FTP", "SSH"]
  };
  
  document.getElementById("texto-pregunta").innerText = preguntaFake.titulo;
  for(let i=0; i<4; i++) {
    document.getElementById(`opc-${i}`).innerText = preguntaFake.opciones[i];
  }

  // Enviamos la pregunta al Namespace de los Players
  socket.emit("enviar_pregunta", { gamePin: miPin, pregunta: preguntaFake });
});

// Escuchar las respuestas de los alumnos
socket.on("respuesta_recibida", (data) => {
  conteoRespuestas++;
  document.getElementById("respuestas-conteo").innerText = conteoRespuestas;
  console.log(`El alumno ${data.playerId} respondió la opción índice: ${data.respuesta}`);
});
