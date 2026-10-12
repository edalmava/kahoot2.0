# Protocolo de eventos y configuración

## Alcance actual: fase 1

Este documento registra el contrato adoptado en T01–T05 de [tasks.md](./tasks.md). El servidor valida estructura y tipos, PIN, nick, contenido de preguntas e ID y tipo de opción en respuestas. Las reglas de sesiones, autorización del profesor, pertenencia, plazo, rango de opciones y respuesta única se completarán en las fases 2–4.

Actualmente, `playerId` sigue siendo el ID de la conexión. Una confirmación de respuesta significa que se recibió y reenvió al profesor; todavía no acredita las reglas de negocio pendientes. Los IDs de pregunta ya se generan en el servidor para que ambos clientes usen el contrato definitivo de envío.

## Configuración

`src/config.js` exporta constantes inmutables `CONFIG` y `CLIENT_CONFIG`. El servidor emite `configuracion` al conectar a `/host` o `/player`; su payload es `CLIENT_CONFIG`, sin envoltorio de confirmación ni puerto.

| Clave | Valor adoptado | Uso |
|---|---|---|
| `port` | `3000` | Solo servidor |
| `pinLength` | `4` | PIN textual de cuatro dígitos ASCII |
| `nicknameMinLength` | `1` | Después de `trim()` |
| `nicknameMaxLength` | `32` | Conteo con `Array.from(nickname).length` |
| `questionDurationMs` | `20000` | Reservado para fase 3 |
| `ackTimeoutMs` | `5000` | Espera de confirmación en ambos clientes |
| `maxRetries` | `2` | Reservado para reintentos de fase 5 |
| `optionCount` | `4` | Opciones textuales no vacías |

Los valores se cambian en el módulo del servidor y se publican al cliente. Publicar duración y reintentos no activa todavía temporizadores ni reenvíos automáticos.

## Solicitudes implementadas

Todas requieren exactamente un objeto y un callback de confirmación. Los campos adicionales del objeto no se utilizan. No se convierten strings a números ni PIN numéricos a strings. Una solicitud sin callback se descarta sin ejecutar la operación.

| Namespace | Evento | Payload | `data` de confirmación |
|---|---|---|---|
| `/host` | `crear_partida` | `{ gamePin }` | `{ pin }` |
| `/host` | `iniciar_juego` | `{ gamePin }` | `{ pin }` |
| `/host` | `enviar_pregunta` | `{ gamePin, pregunta: { titulo, opciones } }` | `{ preguntaId, titulo, opciones, publicadaEn }` |
| `/player` | `unirse_a_partida` | `{ gamePin, nickname }` | `{ pin }` |
| `/player` | `enviar_respuesta` | `{ gamePin, preguntaId, respuestaSeleccionada }` | `{ playerId, preguntaId, respuestaSeleccionada }` |

`respuestaSeleccionada` representa el `indiceOpcion` mencionado en las especificaciones. En esta fase debe ser un número entero; la comprobación de rango contra la pregunta identificada corresponde a T16. `publicadaEn` usa milisegundos del reloj del servidor y no constituye un plazo.

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

Un timeout rechaza la promesa y solo indica ausencia de confirmación. Los errores inesperados devuelven `ERROR_INTERNO` sin detalles internos. El servidor responde como máximo una vez por solicitud.

## Notificaciones implementadas

| Destinatario | Evento | Payload |
|---|---|---|
| Cada conexión | `configuracion` | Límites públicos |
| Profesor de la room | `nuevo_jugador` | `{ id, nickname, puntos }` |
| Jugadores de la room | `juego_iniciado` | `{ pin }` |
| Jugadores de la room | `recibir_pregunta` | `{ preguntaId, titulo, opciones, publicadaEn }` |
| Profesor de la room | `respuesta_recibida` | `{ playerId, preguntaId, respuesta }` |

Las confirmaciones reemplazan los anteriores `partida_creada`, `union_exitosa` y `error_union`. No se emiten además esos eventos, para evitar procesar dos veces una solicitud.

## Errores implementados

- `DATOS_INVALIDOS`: estructura, PIN, nick o contenido de pregunta incorrectos; falta de ID de pregunta o cantidad incorrecta de argumentos.
- `OPCION_INVALIDA`: la opción recibida no es un número entero.
- `PARTIDA_NO_EXISTE`: no se encontró el PIN.
- `PIN_EN_USO`: se evita sobrescribir una partida existente.
- `ERROR_INTERNO`: fallo inesperado controlado.

## Contratos previstos para las siguientes fases

Estos eventos y campos están definidos para el desarrollo siguiente, pero **todavía no están implementados**:

| Namespace/destinatario | Evento | Contrato previsto |
|---|---|---|
| `/player` | `reanudar_sesion` | Solicitud `{ gamePin, token }`; confirmación con PIN, identidad y estado recuperado |
| `/player` | `consultar_estado` | Solicitud `{ gamePin }`; confirmación con estado, pregunta, plazo y respuesta registrada para la sesión validada |
| Jugadores | `pregunta_cerrada` | Notificación `{ preguntaId }` |
| Jugadores | `partida_finalizada` | Notificación `{ pin, motivo }` |

La unión devolverá identidad y token; las preguntas incorporarán `cierraEn`; las notificaciones de respuesta incorporarán el total aceptado. Los contratos de estado devolverán pregunta y respuesta `null` cuando no existan. Los tokens se verificarán en el servidor y no se incluirán en notificaciones públicas.

## Uso de la fábrica y pruebas

`require('../server').createGameServer({ now, logger })` crea una instancia sin escuchar automáticamente. Devuelve `app`, `httpServer`, `io`, `gameService` y `close()`. `now` permite inyectar un reloj; `close()` devuelve una promesa, puede repetirse y libera sockets, servidor HTTP y partidas. `node server.js` conserva el arranque habitual en el puerto 3000.

Ejecutar `pnpm test` con Node.js 24. Se incluyen pruebas de validadores, manejadores, servicio, rutas y eventos reales. Las de integración cargan el cliente distribuido por la dependencia `socket.io` y usan WebSocket nativo. La descarga de `socket.io-client` fue bloqueada por las restricciones de red del entorno; la dependencia de desarrollo de T28 sigue pendiente.

Referencias para las decisiones de validación y confirmación: [validación de eventos](https://socket.io/docs/v4/listening-to-events/#validation) y [confirmaciones con timeout](https://socket.io/docs/v4/emitting-events/#with-timeout).
