# Protocolo de eventos y configuración

## Alcance final: fases 1–6

Este documento registra el contrato adoptado en T01–T27 y verificado en T28–T35 de [tasks.md](./tasks.md). El servidor valida estructura y tipos, PIN, nick, contenido de preguntas, ID y rango de opción en respuestas. Gestiona identidades y sesiones, uniones repetibles, pertenencia, autorización del profesor, ciclo de partida, plazos y una respuesta registrada por jugador y pregunta. Los reintentos idénticos recuperan la aceptación sin duplicar registros ni notificaciones. Las interfaces consultan el estado confirmado, recuperan sesiones y respuestas, limitan los reintentos y regresan al formulario cuando termina la partida.

`playerId` es un UUID generado por el servidor, independiente de `socket.id`. Una confirmación positiva de respuesta acredita una aceptación guardada: nueva y validada dentro del plazo, o recuperada de una solicitud anterior idéntica. El reintento puede confirmarse después del cierre o del cambio de pregunta mientras la partida siga vigente; no abre un nuevo plazo ni vuelve a notificar al profesor.

## Configuración

`src/config.js` exporta constantes inmutables `CONFIG` y `CLIENT_CONFIG`. El servidor emite `configuracion` al conectar a `/host` o `/player`; su payload es `CLIENT_CONFIG`, sin envoltorio de confirmación ni puerto.

| Clave | Valor adoptado | Uso |
|---|---|---|
| `port` | `3000` | Solo servidor |
| `pinLength` | `4` | PIN textual de cuatro dígitos ASCII |
| `nicknameMinLength` | `1` | Después de `trim()` |
| `nicknameMaxLength` | `32` | Conteo con `Array.from(nickname).length` |
| `questionDurationMs` | `20000` | Plazo de cada pregunta, controlado por el servidor |
| `ackTimeoutMs` | `5000` | Espera de confirmación en ambos clientes |
| `maxRetries` | `2` | Hasta dos reenvíos de la misma respuesta: tres intentos en total |
| `optionCount` | `4` | Opciones textuales no vacías |

Los valores se cambian en el módulo del servidor y se publican al cliente. La duración controla los temporizadores; el cliente utiliza el timeout y el límite de reintentos para recuperar confirmaciones pendientes.

## Solicitudes implementadas

Todas requieren exactamente un objeto y un callback de confirmación. Los campos adicionales del objeto no se utilizan. No se convierten strings a números ni PIN numéricos a strings. Una solicitud sin callback se descarta sin ejecutar la operación.

| Namespace | Evento | Payload | `data` de confirmación |
|---|---|---|---|
| `/host` | `crear_partida` | `{ gamePin }` | `{ pin }` |
| `/host` | `iniciar_juego` | `{ gamePin }` | `{ pin }` |
| `/host` | `enviar_pregunta` | `{ gamePin, pregunta: { titulo, opciones } }` | `{ preguntaId, titulo, opciones, cierraEn }` |
| `/player` | `unirse_a_partida` | `{ gamePin, nickname }` | `{ pin, playerId, token, nickname, estado, pregunta, preguntaAbierta, respuesta }` |
| `/player` | `reanudar_sesion` | `{ gamePin, token }` | `{ pin, playerId, token, nickname, estado, pregunta, preguntaAbierta, respuesta }` |
| `/player` | `consultar_estado` | `{ gamePin }` | `{ pin, estado, pregunta, preguntaAbierta, respuesta }` |
| `/player` | `enviar_respuesta` | `{ gamePin, preguntaId, respuestaSeleccionada }` | `{ playerId, preguntaId, respuestaSeleccionada }` |

`respuestaSeleccionada` representa el `indiceOpcion` mencionado en las especificaciones. Debe cumplir `Number.isInteger(respuestaSeleccionada)` y `0 <= respuestaSeleccionada < pregunta.opciones.length`. `pregunta` es `null` si todavía no se publicó ninguna; de lo contrario contiene `{ preguntaId, titulo, opciones, cierraEn }`. `cierraEn` es el instante límite en milisegundos del reloj del servidor y sustituye a `publicadaEn`. `preguntaAbierta` informa si esa pregunta admite respuestas según el estado y la hora del servidor al producir el snapshot; vale `false` cuando no hay pregunta.

`respuesta` es la aceptación registrada para el jugador validado en la pregunta actual: `{ playerId, preguntaId, respuestaSeleccionada }`, o `null` si no existe. `consultar_estado` verifica sesión activa y pertenencia, devuelve copias de los datos públicos y no incluye el token ni respuestas ajenas.

```js
socket.timeout(configuracion.ackTimeoutMs).emitWithAck('enviar_respuesta', {
  gamePin: '1234',
  preguntaId: 'id-recibido-con-la-pregunta',
  respuestaSeleccionada: 2
});
```

La promesa devuelve una confirmación, tanto para aceptación como para rechazo de negocio:

```js
{ ok: true, data: { /* datos según el evento */ } }
{ ok: false, error: { code: 'DATOS_INVALIDOS', message: 'Descripción para el usuario.' } }
```

Estos son los acknowledgements nativos de Socket.IO: los clientes usan `socket.timeout(...).emitWithAck(...)` y el servidor invoca el callback mediante `registerRequest`. Un timeout rechaza la promesa y solo indica ausencia de confirmación; la respuesta podría estar registrada. Los errores inesperados devuelven `ERROR_INTERNO` sin detalles internos. El servidor responde como máximo una vez por solicitud. El jugador reenvía la misma pregunta y opción hasta dos veces y consulta el estado si agota los intentos sin confirmación.

## Notificaciones implementadas

| Destinatario | Evento | Payload |
|---|---|---|
| Cada conexión | `configuracion` | Límites públicos |
| Profesor de la room | `nuevo_jugador` | `{ id, nickname, puntos }` |
| Jugadores de la room | `juego_iniciado` | `{ pin }` |
| Profesor y jugadores de la room | `recibir_pregunta` | `{ preguntaId, titulo, opciones, cierraEn }` |
| Profesor y jugadores de la room | `pregunta_cerrada` | `{ preguntaId }` |
| Profesor de la room | `respuesta_recibida` | `{ playerId, preguntaId, respuesta, totalAceptado }` |
| Jugadores de la room | `partida_finalizada` | `{ pin, motivo }` |
| Conexión reemplazada | `sesion_reemplazada` | `{ message }`, seguido de desconexión del namespace |

Las confirmaciones reemplazan los anteriores `partida_creada`, `union_exitosa` y `error_union`. No se emiten además esos eventos, para evitar procesar dos veces una solicitud.

## Registro y deduplicación de respuestas

1. Validar la solicitud y comprobar sesión activa, pertenencia y vigencia de la partida.
2. Localizar la pregunta por ID y validar la opción contra sus opciones, incluso si ya existe una respuesta.
3. Consultar su `Map` de respuestas por `playerId`. Si coincide la opción, devolver una copia de la aceptación guardada. Si cambia, rechazar con `YA_RESPONDIO`.
4. Para una respuesta nueva, exigir pregunta activa y plazo abierto; comprobar y guardar de forma síncrona, sin ningún `await` intermedio.
5. Emitir `respuesta_recibida` solo para un registro nuevo y confirmar con `{ playerId, preguntaId, respuestaSeleccionada }`.

El servicio devuelve internamente `{ data, nuevo, totalAceptado }`. Solo `data` forma parte del acuse, por lo que un reintento conserva exactamente su aceptación aunque otros jugadores hayan respondido. `totalAceptado` es el tamaño del `Map` de esa pregunta después del registro y viaja en la notificación al profesor. Se conserva `respuesta` como nombre de la opción en esa notificación para mantener la compatibilidad del cliente.

Las respuestas permanecen asociadas a su pregunta al cambiar de pregunta o desconectarse el jugador. Reanudar la sesión conserva la deduplicación. Una conexión ajena o revocada no puede recuperar una aceptación presentando un `playerId` o un token en `enviar_respuesta`. Finalizar la partida impide nuevos acuses positivos, incluidos los reintentos. La garantía de registro síncrono corresponde al almacenamiento en memoria en un solo proceso.

## Ciclo de partida, autorización y plazos

- Una partida nace en `lobby`. Solo su `hostSocketId` puede ejecutar `iniciar_juego` y `enviar_pregunta`; la pertenencia a una room o al namespace `/host` no autoriza estas operaciones. Un PIN ocupado devuelve `PIN_EN_USO` y conserva profesor, jugadores, sesiones, preguntas y temporizador.
- `iniciar_juego` pasa a `en_curso`. Repetirlo conserva la pregunta y su plazo. Publicar antes del inicio devuelve `JUEGO_NO_INICIADO`.
- Cada pregunta tiene un UUID, `abiertaEn`, `cierraEn`, indicador `abierta` y un `Map` de aceptaciones por jugador. Las preguntas se guardan por ID y `preguntaActual` referencia la activa; las anteriores se conservan cerradas con sus respuestas.
- La duración es siempre `CONFIG.questionDurationMs`. El servidor ignora IDs, plazos y duraciones enviados por el cliente. Guarda la pregunta y programa su cierre antes de notificar `recibir_pregunta`.
- Para registrar una respuesta nueva exige pertenencia, partida en curso, pregunta activa coincidente y abierta, y `abiertaEn <= ahora < cierraEn`. Rechaza exactamente al cierre o después, aunque el callback del temporizador esté pendiente. Una respuesta rechazada no se reenvía al profesor. Los reintentos idénticos confirman el registro anterior antes de comprobar el plazo.
- Al vencer el temporizador marca la pregunta cerrada y emite `pregunta_cerrada` una sola vez al profesor y los jugadores de esa partida. Un callback adelantado se reprograma por el tiempo restante. Cambiar de pregunta cancela el temporizador anterior; además, cada callback verifica el ID y el estado para no afectar a otra pregunta.
- El servicio ofrece `finalizarPartida(hostSocketId, { gamePin })`: verifica al propietario, cancela el temporizador, cierra la pregunta, pasa a `finalizada` y elimina respuestas, preguntas, jugadores, sesiones, asociaciones de conexiones y la partida. El PIN queda disponible de nuevo y las credenciales anteriores dejan de ser válidas.
- Desconectar al profesor finaliza todas sus partidas, emite `partida_finalizada` a sus jugadores, elimina sus datos de pertenencia en `socket.data` y los retira de las rooms. Los jugadores conservan la conexión y pueden unirse a otra partida. Las partidas de otros profesores no se alteran. Desconectar a un jugador conserva su sesión y respuestas hasta la finalización. Cerrar la instancia finaliza todas las partidas y libera temporizadores, sesiones y datos.

## Identidad, pertenencia y recuperación

- Cada partida guarda jugadores en un `Map` por `playerId`. Las sesiones y las conexiones activas se mantienen en registros separados del servicio, sin exponer tokens en el listado de jugadores.
- La primera unión genera un token mediante `randomBytes(32).toString('hex')`. Repetir la unión desde la misma conexión y partida devuelve identidad, token y nick originales; no cambia el nombre ni emite otro `nuevo_jugador`.
- La conexión validada guarda exclusivamente `playerId` y `gamePin` en `socket.data`. Cada respuesta debe coincidir con estos datos, la sesión activa y el jugador registrado. Un PIN conocido, una room o un `playerId` añadido al payload no sustituyen esa validación.
- `reanudar_sesion` exige un PIN válido y un token hexadecimal de 64 caracteres que corresponda a esa partida. No crea jugadores. Devuelve la identidad original, una copia de la pregunta actual, su apertura según el reloj del servidor y la aceptación propia para restaurar la pantalla.
- Solo una conexión puede estar activa por sesión. Recuperarla borra la asociación de la anterior, le notifica `sesion_reemplazada` y la desconecta. Desconectar la anterior no desactiva la nueva. Reanudar desde la conexión ya activa es repetible.
- Una conexión asociada no puede unirse a otra partida ni adoptar otro token. Para crear otro participante se necesita una conexión nueva mediante la acción explícita del formulario.

La identidad de sesión sigue la recomendación de [Socket.IO sobre el carácter efímero de `socket.id`](https://socket.io/docs/v4/client-socket-instance/#socketid). El token es una credencial de recuperación: solo se devuelve al solicitante validado y nunca se incluye en notificaciones al profesor, a otros jugadores ni en logs.

## Comportamiento del cliente

El formulario conserva el PIN como texto, incluidos ceros iniciales, y aplica formato y longitud recibidos en `configuracion`. El nick se normaliza con `trim()` y se valida por puntos de código Unicode, igual que en el servidor; los límites y errores se muestran junto al formulario.

`public/js/player.js` guarda `{ pin, playerId, token, nickname, pendiente }` en `sessionStorage`, bajo la clave `kahoot.playerSession`. `pendiente` es `null` o `{ preguntaId, respuestaSeleccionada, intentos }`. El contador se guarda antes de cada envío y no se reinicia al recargar o reconectar. Se aceptan credenciales del formato anterior, pero se ignora `preguntaBloqueadaId`: la aceptación y apertura proceden del servidor.

La interfaz distingue espera, pregunta abierta, enviando, confirmación pendiente, aceptada, cerrada, recuperando y desconectada. Solo permite seleccionar cuando está conectada, con sesión recuperada y pregunta abierta sin aceptación ni envío pendiente. «Respuesta aceptada» requiere un acuse positivo de respuesta o una consulta positiva que contenga la aceptación guardada. Un rechazo conserva su motivo y consulta el estado antes de permitir otra selección.

Tras un timeout conserva pregunta y opción, muestra «Confirmación pendiente» y reenvía esa misma respuesta hasta completar tres intentos. Agotados los intentos, consulta el estado: una aceptación mantiene el bloqueo; una pregunta abierta sin registro permite elegir de nuevo. Si la consulta falla, conserva los datos y el bloqueo y ofrece «Consultar estado». Un cierre durante el envío no impide recuperar una aceptación anterior mediante un reintento idéntico.

Al recargar o reconectar, espera `configuracion`, reanuda la sesión y ejecuta `consultar_estado` antes de habilitar acciones o consumir los intentos restantes de una respuesta pendiente. Si cambia la pregunta o llega su cierre durante la consulta, repite la consulta para no aplicar un snapshot anterior. Ambos clientes filtran cierres por ID. El reloj del navegador no decide la apertura.

Los listeners se registran una sola vez, fuera de `connect`. No se emiten respuestas estando desconectado ni se usan eventos `volatile`. Cambiar de pregunta, finalizar o cambiar de conexión invalida las operaciones anteriores: un acuse tardío no acepta ni bloquea otra pregunta. Una pregunta nueva descarta la solicitud pendiente de la anterior.

El panel recibe `recibir_pregunta` antes de que el servidor notifique a los jugadores e inicializa pregunta y contador a cero. `respuesta_recibida` actualiza el contador con `totalAceptado`, filtrando por `preguntaId` y sin incrementos locales; una confirmación tardía de publicación no reinicia un contador ya actualizado. Desconectar al profesor limpia la vista; al reconectar debe crear una partida nueva.

`partida_finalizada` elimina la credencial y devuelve al jugador al formulario con el motivo. Si el servidor se reinicia, la recuperación rechazada hace lo mismo. Si falta confirmación durante la recuperación, conserva la sesión conocida y mantiene las acciones bloqueadas. La conexión reemplazada olvida su token y no intenta recuperar automáticamente el control.

El botón «Iniciar otra sesión» elimina la credencial local, desconecta y crea una nueva conexión para volver al formulario. El participante anterior permanece registrado hasta finalizar la partida. Cerrar o reiniciar la instancia invalida todas sus sesiones.

## Errores implementados

- `DATOS_INVALIDOS`: estructura, PIN, nick o contenido de pregunta incorrectos; falta de ID de pregunta o cantidad incorrecta de argumentos.
- `OPCION_INVALIDA`: la opción recibida no es un número entero o queda fuera de las opciones de la pregunta identificada.
- `YA_RESPONDIO`: se intenta cambiar una respuesta ya aceptada por otra opción válida.
- `PARTIDA_NO_EXISTE`: no se encontró el PIN.
- `PIN_EN_USO`: se evita sobrescribir una partida existente.
- `NO_AUTORIZADO`: el profesor de la conexión no es el propietario de la partida.
- `JUEGO_NO_INICIADO`: se intenta publicar una pregunta antes de iniciar el juego.
- `SIN_PREGUNTA_ACTIVA`: se intenta responder antes del inicio o sin una pregunta.
- `PREGUNTA_INCORRECTA`: el ID no existe en la partida o se intenta registrar una respuesta nueva para una pregunta que ya no es la activa.
- `PLAZO_CERRADO`: se intenta registrar una respuesta nueva cuando la pregunta está cerrada o la hora del servidor queda fuera de su ventana.
- `NO_PERTENECE`: no coinciden conexión, asociación, partida y registro de jugador.
- `SESION_INVALIDA`: token incorrecto, conexión revocada o intento de cambiar de sesión o partida sin una conexión nueva.
- `ERROR_INTERNO`: fallo inesperado controlado.

## Cierre del alcance

Las seis fases están completadas. La fase 6 verificó la cobertura de los criterios, incorporó `socket.io-client` como dependencia de desarrollo con su lockfile y completó la verificación integral de T28–T35. La matriz y los resultados están en [verification.md](./verification.md). El almacenamiento permanece en memoria en un único proceso; la identidad y la garantía de respuesta única corresponden a la sesión, según el alcance del plan.

## Uso de la fábrica y pruebas

`require('../server').createGameServer({ now, setTimer, clearTimer, logger })` crea una instancia sin escuchar automáticamente. Devuelve `app`, `httpServer`, `io`, `gameService` y `close()`. Las opciones son opcionales: `now`, `setTimer` y `clearTimer` usan `Date.now`, `setTimeout` y `clearTimeout` por defecto y permiten verificar plazos sin esperar tiempo real. El servicio recibe además `onQuestionClosed(gamePin, { preguntaId })` para notificar cierres sin depender de Socket.IO. `close()` devuelve una promesa, puede repetirse y libera temporizadores, sockets, servidor HTTP y partidas. `node server.js` conserva el arranque habitual en el puerto 3000.

Ejecutar `pnpm install --frozen-lockfile` y `pnpm test` con Node.js 24. Las 102 pruebas actuales cubren validadores, manejadores, servicio, rutas, eventos reales, sesiones e interfaces; además verifican estados, autorización, límites del plazo, temporizadores, rango de opciones, envíos simultáneos, deduplicación entre preguntas, reconexión y códigos de rechazo con un solo acuse. Una prueba descarta únicamente el primer acuse para provocar un timeout real y verifica el reintento después del cierre sin duplicar registros ni notificaciones. `test-support/manual-clock.js` permite controlar reloj y callbacks, incluidos los ya cancelados. `test/browser-client.test.js` ejecuta los scripts de las interfaces con DOM, sockets y almacenamiento controlados mediante `test-support/browser-client.js`, sin necesitar un navegador para `pnpm test`. Comprueba validación Unicode, reintentos limitados, recuperación, rechazos, acuses tardíos, cambios de pregunta, cierres y contador confirmado. Las pruebas de integración importan `socket.io-client`, fijado en el lockfile a 4.8.4, y se conectan por WebSocket a puertos efímeros; también verifican consulta de estado y limpieza al desconectarse el profesor. Los hooks cierran clientes, servidores y servicios, y la ejecución termina normalmente sin forzar su salida.

Se comprobó también en Chrome sin interfaz el flujo de juego, la recarga, la reconexión, la recuperación desde otra pestaña, el inicio explícito de otra sesión y el descarte de credenciales inválidas o almacenamiento corrupto, sin errores JavaScript.

La verificación de fase 3 en Chrome sin interfaz comprobó un profesor y dos jugadores, rechazo visible de PIN ocupado y desconocido, entrega de pregunta, respuesta, contador, botones bloqueados, cierre real de 20 segundos, reloj del navegador alterado, rechazo tardío, recarga de una pregunta cerrada y habilitación de una nueva pregunta. No se detectaron errores de JavaScript ni del servidor. Las comprobaciones de sintaxis también pasaron.

La verificación de fase 4 en Chrome sin interfaz comprobó un profesor y dos jugadores, PIN desconocido, pregunta, respuesta, bloqueo de botones, duplicados concurrentes, opción inválida, cambio rechazado, pérdida real de un acuse con timeout y reintento después del cierre y de recargar. Se conservaron dos registros y el contador en dos, sin errores de JavaScript ni del servidor. Las comprobaciones de sintaxis también pasaron.

La verificación de fase 5 en Chrome sin interfaz comprobó un profesor y dos jugadores, formulario Unicode, PIN desconocido, doble clic, aceptación y rechazo reconciliado, pérdida real de tres acuses con reintentos limitados, consulta de aceptación, recarga, acuse antiguo tras cambiar de pregunta, contador confirmado, reconexión, cierre, finalización al desconectar al profesor y reinicio del servidor. Las interfaces regresaron al formulario cuando correspondía, sin errores JavaScript ni del servidor. Las comprobaciones de sintaxis también pasaron.

La verificación final de fase 6 volvió a ejecutar el flujo en Chrome sin interfaz contra `pnpm start`, sin sustituir el reloj ni la configuración: un profesor y dos jugadores, PIN desconocido, doble clic, aceptación y botones bloqueados, contador confirmado, reconexión, recarga, nueva pregunta, cierre real de 20 segundos, rechazo tardío y limpieza al desconectarse el profesor. No hubo errores JavaScript ni del servidor. La instalación con lockfile congelado, las 102 pruebas y la sintaxis de los 15 archivos JavaScript pasaron. Véase [verification.md](./verification.md).

Referencias para las decisiones de validación y confirmación: [validación de eventos](https://socket.io/docs/v4/listening-to-events/#validation) y [confirmaciones con timeout](https://socket.io/docs/v4/emitting-events/#with-timeout).
