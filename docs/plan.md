# Plan de implementación de las especificaciones

## Objetivo y alcance

Implementar [specs.md](./specs.md) haciendo que el servidor controle la pertenencia, las preguntas, los plazos y las respuestas aceptadas. Adaptar las interfaces de jugador y profesor y añadir pruebas automatizadas de las reglas.

Mantener Express, CommonJS, los namespaces `/host` y `/player`, y las partidas en memoria en un solo proceso. La persistencia, el despliegue con varias instancias y la identificación de personas mediante cuentas quedan para una evolución posterior. La garantía será por sesión de jugador: crear otra sesión representa otro participante.

## Estado de ejecución

Las seis fases están completadas y verificadas. El seguimiento final está en [tasks.md](./tasks.md), el contrato implementado en [protocol.md](./protocol.md) y la evidencia de aceptación en [verification.md](./verification.md). Las decisiones iniciales de configuración se adoptaron sin cambios.

## Situación inicial antes de la implementación

- `server.js` comprueba que el PIN exista, pero reenvía respuestas sin validar pertenencia, pregunta, plazo, opción ni duplicados.
- `public/js/player.js` bloquea botones y anuncia el envío sin confirmación del servidor.
- `public/js/host.js` genera el PIN, envía una pregunta fija e incrementa un contador local por cada notificación.
- No hay preguntas almacenadas, temporizadores ni pruebas automatizadas.

## Decisiones iniciales

Estos valores son propuestas de implementación; las especificaciones no fijan límites del nombre ni duración de preguntas:

| Parámetro | Propuesta |
|---|---|
| PIN | Cadena que cumpla `/^[0-9]{4}$/`, sin conversión numérica |
| Nick | `trim()`, entre 1 y 32 puntos de código Unicode |
| Duración de pregunta | 20 segundos, configurable en el servidor |
| Espera de confirmación | 5 segundos; como máximo 2 reintentos de la misma solicitud |
| Opciones | Cuatro cadenas no vacías, para conservar la interfaz actual |

Centralizar los límites en `src/config.js` y entregarlos al jugador al conectar. Las comprobaciones del navegador sirven para informar; el servidor siempre vuelve a validar.

## 1. Separar las reglas y preparar los contratos

**Archivos:** `server.js`, nuevos `src/config.js`, `src/validators.js` y `src/game-service.js`.

- Mantener en `server.js` las rutas y el registro de eventos. Extraer validadores y operaciones de partidas a módulos pequeños, sin depender del DOM ni de sockets dentro de las reglas.
- Exportar una fábrica del servidor que permita crear instancias aisladas y escuchar en un puerto efímero durante las pruebas. Conservar `pnpm start` como entrada normal.
- Validar el objeto completo antes de desestructurarlo; rechazar `null`, arrays, campos ausentes y tipos incorrectos sin lanzar errores sin controlar.
- Comprobar que el callback de confirmación sea una función. Una solicitud que requiera confirmación y llegue sin callback se descarta sin mutar estado. Capturar errores inesperados y devolver `ERROR_INTERNO` sin detalles internos.

Usar un único formato de acuse de recibo para las solicitudes:

```js
// Aceptación
{ ok: true, data: { preguntaId, respuestaSeleccionada } }
// Rechazo
{ ok: false, error: { code: 'OPCION_INVALIDA', message: 'Opción inválida.' } }
```

Conservar `respuestaSeleccionada` como nombre del campo enviado: representa el `indiceOpcion` de las especificaciones. Añadir `preguntaId` a `enviar_respuesta`:

```js
{ gamePin: '1234', preguntaId: 'id-generado-por-servidor', respuestaSeleccionada: 2 }
```

Modificar productores y consumidores juntos. Las confirmaciones informan al solicitante; los eventos notifican cambios al resto, evitando procesar dos veces la misma acción. La validación de argumentos y la captura de errores corresponden a la aplicación, según [Socket.IO: escuchar eventos](https://socket.io/docs/v4/listening-to-events/#validation).

**Resultado:** contratos documentados y validadores verificables sin iniciar el servidor.

## 2. Registrar jugadores y acreditar pertenencia

**Archivos:** `src/game-service.js`, `server.js`, `public/js/player.js`.

- Guardar jugadores en un `Map` por `playerId` generado por el servidor. Asociar la conexión validada mediante `socket.data.playerId` y `socket.data.gamePin`.
- Al unirse, validar PIN y nick, comprobar la existencia de la partida y registrar al jugador una sola vez. Repetir una unión ya confirmada no debe duplicarlo.
- Generar un token secreto de sesión con `node:crypto`, asociado a ese jugador y partida. Conservarlo en `sessionStorage`, verificarlo en una operación `reanudar_sesion` y vincular entonces la nueva conexión. No confiar en un `playerId` enviado por el navegador ni registrar el token en los logs.
- Permitir una conexión activa por sesión; invalidar la asociación anterior al reanudar. Los reintentos de unión en la misma conexión deben devolver la misma sesión, incluso si se perdió el primer acuse.
- Para cada respuesta, exigir coincidencia entre `gamePin`, la asociación de la conexión y el registro de jugadores. La room sirve para distribuir eventos y no sustituye esta comprobación.
- Rechazar cambios de partida dentro de una sesión; permitir iniciar otra sesión explícitamente desde el formulario.

Una identidad de sesión evita que una reconexión habilite una segunda respuesta: [Socket.IO advierte que `socket.id` es efímero](https://socket.io/docs/v4/client-socket-instance/#socketid).

**Resultado:** conocer un PIN no permite responder sin haberse unido; reconectar conserva la identidad del participante.

## 3. Controlar preguntas y plazos en el servidor

**Archivos:** `src/game-service.js`, `server.js`, `public/js/host.js`.

- Añadir a cada partida estado `lobby`, `en_curso` o `finalizada`; guardar preguntas por ID y una referencia a la pregunta activa.
- Validar que quien inicia el juego o envía una pregunta sea el profesor propietario (`hostSocketId`). Pertenecer al namespace `/host` no concede control sobre cualquier partida.
- Validar título y opciones antes de abrir la pregunta. Rechazar un PIN ocupado al crear partida para evitar sobrescribir jugadores y respuestas existentes.
- Generar `preguntaId`, registrar opciones, apertura, cierre y un `Map` de respuestas por jugador. El servidor decide la duración y transmite `{ preguntaId, titulo, opciones, cierraEn }` mediante `recibir_pregunta`.
- Aceptar respuestas nuevas únicamente mientras la pregunta indicada sea la activa, esté abierta y `ahora < cierraEn`. Inyectar el reloj en el servicio para probar los límites del plazo.
- Programar un temporizador para cerrar y emitir `pregunta_cerrada`; comprobar también la hora al recibir cada respuesta, aunque el temporizador se haya retrasado.
- Cancelar el temporizador anterior al cambiar de pregunta. Su callback debe comprobar el ID para no cerrar una pregunta posterior.

**Resultado:** el cliente no puede abrir el plazo ni responder a preguntas antiguas modificando eventos.

## 4. Aceptar respuestas sin duplicarlas

**Archivos:** `src/game-service.js`, `server.js`.

Procesar `enviar_respuesta` en este orden:

1. Validar estructura, tipos, PIN e ID de pregunta.
2. Verificar sesión y pertenencia a la partida.
3. Localizar la pregunta y exigir `Number.isInteger(respuestaSeleccionada)` y `0 <= respuestaSeleccionada < opciones.length`.
4. Consultar una respuesta previa para ese jugador y pregunta. Si repite la misma opción, devolver la aceptación guardada sin registrar ni notificar otra vez. Si intenta cambiarla, devolver `YA_RESPONDIO`.
5. Para una respuesta nueva, comprobar pregunta activa y plazo abierto; registrar la respuesta antes de confirmar o emitir notificaciones.
6. Notificar al profesor con `preguntaId`, `playerId`, opción y total de respuestas aceptadas.

La consulta de una aceptación previa puede confirmar un reintento después del cierre: acredita una respuesta ya registrada y no acepta una respuesta nueva fuera de plazo. Conservar esos registros hasta finalizar la partida.

Realizar la comprobación y el registro de forma síncrona, sin `await` intermedio, en el proceso actual. Si se incorpora almacenamiento externo, trasladar esta garantía a una operación atómica con clave única `(partida, pregunta, jugador)`.

Devolver códigos distinguibles: `DATOS_INVALIDOS`, `PARTIDA_NO_EXISTE`, `NO_PERTENECE`, `SESION_INVALIDA`, `SIN_PREGUNTA_ACTIVA`, `PREGUNTA_INCORRECTA`, `PLAZO_CERRADO`, `OPCION_INVALIDA` y `YA_RESPONDIO`.

**Resultado:** solicitudes repetidas o concurrentes producen como máximo un registro y una notificación. Los reintentos requieren esta protección porque Socket.IO no ofrece por defecto una garantía de entrega exactamente una vez: [garantías de entrega](https://socket.io/docs/v4/delivery-guarantees/).

## 5. Adaptar interfaces y gestionar desconexiones

**Archivos:** `public/player.html`, `public/js/player.js`, `public/js/host.js` y, si hace falta, `public/css/style.css`.

- Cambiar el PIN a `type="text"` con `inputmode="numeric"`, patrón y longitud de cuatro caracteres. Validar el nick con los mismos límites y criterio Unicode del servidor.
- Guardar el PIN confirmado y la pregunta recibida. Modelar estados de interfaz: espera, pregunta abierta, enviando, aceptada y cerrada.
- Enviar la respuesta con acuse y timeout usando `socket.timeout(...).emit(...)`. Bloquear botones durante el envío y mostrar «Respuesta aceptada» solo al recibir `ok: true`. Véase [confirmaciones con timeout](https://socket.io/docs/v4/emitting-events/#with-timeout).
- Si no llega confirmación, conservar la misma opción y pregunta: mostrar «Confirmación pendiente» y reintentar esa solicitud de forma limitada. Un timeout no demuestra rechazo. No habilitar otra opción hasta reconciliar el estado.
- En un rechazo, mostrar el motivo y habilitar botones únicamente si el estado confirmado permite volver a responder. Ignorar confirmaciones antiguas al actualizar la pantalla de otra pregunta.
- Al desconectar, bloquear acciones. Al reconectar, reanudar la sesión y solicitar un estado actualizado antes de enviar o reintentar. Devolver pregunta, plazo y respuesta ya registrada; registrar listeners una sola vez, fuera de `connect`.
- Evitar emisiones cuando `socket.connected` sea falso. Los mensajes retrasados deben seguir sujetos a ID y plazo; no usar eventos `volatile` para respuestas.
- Actualizar el contador del profesor desde el total del servidor y filtrar por `preguntaId`, reemplazando `conteoRespuestas++`.
- Conservar respuestas y sesiones del jugador desconectado hasta terminar la partida. Si se desconecta el profesor, finalizar la partida, avisar a los jugadores y eliminar temporizadores, sesiones y datos. Un reinicio también invalida las sesiones en memoria.

Las rooms se abandonan automáticamente al desconectar, pero la limpieza del estado de negocio corresponde al servidor: [rooms y desconexión](https://socket.io/docs/v4/rooms/#disconnection).

**Resultado:** la interfaz refleja aceptaciones confirmadas y recupera el estado tras una interrupción.

## 6. Verificar las reglas y cerrar la implementación

**Archivos:** nuevos `test/validators.test.js`, `test/game-service.test.js`, `test/socket-events.test.js`, más `package.json` y `pnpm-lock.yaml`.

Usar `node:test` y `node:assert/strict`, disponibles en Node.js 24 del entorno, y añadir `socket.io-client` como dependencia de desarrollo para pruebas reales de eventos. Sustituir el script placeholder por `node --test`. El enfoque está ilustrado en las [pruebas oficiales de Socket.IO](https://socket.io/docs/v4/testing/).

| Caso | Resultado esperado |
|---|---|
| Payload ausente, `null`, array, PIN numérico o mal formado | Rechazo controlado, sin mutaciones ni caída del servidor |
| Nick vacío, solo espacios, Unicode y límites 1/32/33 | Normalización y validación coherentes |
| Jugador sin registro o con PIN de otra partida | No se registra ni notifica respuesta |
| Opción string, decimal, negativa o fuera del array | `OPCION_INVALIDA` |
| Sin pregunta, ID antiguo, pregunta cerrada | Rechazo, sin aumentar el contador |
| Justo antes, exactamente al cierre y después | Solo la primera respuesta nueva es aceptada |
| Dos envíos simultáneos o distintos para la misma pregunta | Un registro y una notificación |
| Acuse perdido y reintento idéntico, incluso tras cerrar | Misma aceptación, sin duplicar efectos |
| Reconexión con token válido, falso o de otra partida | Recuperación autorizada o rechazo |
| Nueva pregunta y callback del temporizador anterior | Estado y respuestas independientes |
| Profesor ajeno, PIN ocupado y desconexión del profesor | Sin modificación indebida; limpieza correcta |

En integración, escuchar en un puerto efímero, registrar listeners antes de emitir y cerrar clientes, servidor y temporizadores al terminar. Usar reloj inyectado para los plazos, evitando esperas largas o pruebas dependientes de tiempos exactos.

Ejecutar `pnpm test`, revisar sintaxis con `node --check` en archivos modificados y realizar una prueba manual con un profesor y dos jugadores: unión, errores, pregunta, envío, doble clic, cierre y reconexión.

## Orden de ejecución y criterio de finalización

Ejecutar las fases 1 a 5 en orden y añadir las pruebas correspondientes durante cada fase; usar la fase 6 para la verificación conjunta. Marcar cada fase completada únicamente cuando su resultado esté verificado.

La implementación estará terminada cuando las cinco reglas de `specs.md` se cumplan en el servidor, los rechazos no alteren el estado, los reintentos no dupliquen respuestas y ambas interfaces reflejen el estado confirmado. Documentar el protocolo final y los valores de configuración realmente adoptados.
