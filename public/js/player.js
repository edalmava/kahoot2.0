// Nos conectamos ESTRICTAMENTE al namespace '/player'
const socket = io("/player"); 

let miPinActual = "";

const pLogin = document.getElementById("pantalla-login");
const pEspera = document.getElementById("pantalla-espera");
const pBotones = document.getElementById("pantalla-botones");

// Intentar unirse al juego
document.getElementById("btn-unirse").addEventListener("click", () => {
  const pin = document.getElementById("input-pin").value;
  const nick = document.getElementById("input-nick").value;

  if(!pin || !nick) return alert("Llena todos los campos");

  miPinActual = pin;
  socket.emit("unirse_a_partida", { gamePin: pin, nickname: nick });
});

// Servidor aprueba el ingreso
socket.on("union_exitosa", (data) => {
  pLogin.style.display = "none";
  pEspera.style.display = "block";
});

// Servidor rechaza el ingreso (PIN incorrecto)
socket.on("error_union", (mensaje) => {
  document.getElementById("error-msg").innerText = mensaje;
});

// El host da inicio al juego
socket.on("juego_iniciado", () => {
  pEspera.style.display = "none";
  // Aquí podríamos mostrar una pantalla de carga corta
});

// Llega una pregunta: activamos los botones de respuestas de colores
socket.on("recibir_pregunta", (pregunta) => {
  pEspera.style.display = "none";
  pBotones.style.display = "block";
  
  // Habilitamos todos los botones por si estaban bloqueados de la pregunta anterior
  const botones = document.querySelectorAll(".btn-opcion");
  botones.forEach(b => b.disabled = false);
});

// Función cuando el usuario hace clic en una figura/color
function responder(indiceOpcion) {
  socket.emit("enviar_respuesta", { 
    gamePin: miPinActual, 
    respuestaSeleccionada: indiceOpcion 
  });

  // Bloqueamos la botonera para que no pueda cambiar de respuesta
  const botones = document.querySelectorAll(".btn-opcion");
  botones.forEach(b => b.disabled = true);
  
  alert("Respuesta enviada, espera al Host...");
}
