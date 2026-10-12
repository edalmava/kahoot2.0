# Tareas de implementación

## Referencias y forma de trabajo

Ejecutar el [plan](./plan.md) para cumplir las [especificaciones](./specs.md). Las fases 1–6 están completadas y verificadas. Marcar una casilla únicamente cuando el cambio y su verificación estén completos.

Seguir las fases en orden y añadir pruebas durante cada fase; la última reúne la verificación integral. Mantener CommonJS, Express, los namespaces actuales y el almacenamiento en memoria en un solo proceso. La identidad corresponde a una sesión de jugador, no a una persona con cuenta.

## Punto de continuación para la próxima sesión

**Plan completado: T01–T35.** No quedan tareas pendientes de estas seis fases. Conservar lo implementado y definir cualquier trabajo posterior según el nuevo alcance solicitado.

Consultar [specs.md](./specs.md), [plan.md](./plan.md), [protocol.md](./protocol.md) y [verification.md](./verification.md) antes de realizar nuevos cambios. La integración usa la dependencia de desarrollo `socket.io-client`; las pruebas de validadores, servicio, transporte e interfaces cubren los criterios del plan. Conservar estados, autorización, plazos, sesiones, deduplicación, recuperación y limpieza ya implementados.

**Última verificación (fase 6):** 102 pruebas aprobadas con `pnpm test`, instalación reproducible con `pnpm install --frozen-lockfile`, sintaxis correcta en los 15 archivos JavaScript y flujo con un profesor y dos jugadores en Chrome sin interfaz contra `pnpm start`. Se comprobaron PIN desconocido, doble clic, aceptación, contador, reconexión, recarga, cambio de pregunta, cierre real de 20 segundos, rechazo tardío y finalización sin errores JavaScript ni del servidor. Evidencia detallada en [verification.md](./verification.md).

## Fase 1. Configuración, contratos y estructura

**Dependencias:** ninguna. **Archivos:** `server.js`, `src/config.js`, `src/validators.js`, `src/game-service.js`.

- [x] **T01. Centralizar la configuración.** Adoptar inicialmente las propuestas del plan: PIN de cuatro dígitos, nick de 1 a 32 puntos de código Unicode después de `trim()`, preguntas de 20 segundos, timeout de 5 segundos y hasta 2 reintentos. Publicar al cliente los límites que necesita y documentar cualquier ajuste.
- [x] **T02. Definir los contratos de eventos.** Documentar solicitudes, notificaciones y confirmaciones `{ ok, data }` o `{ ok, error: { code, message } }`. Conservar `respuestaSeleccionada` como equivalente de `indiceOpcion` y añadir `preguntaId` al envío de respuestas. Definir también `reanudar_sesion`, la consulta de estado y `pregunta_cerrada`.
- [x] **T03. Separar las reglas del transporte.** Extraer configuración, validadores y servicio de partidas. Exportar una fábrica del servidor con estado aislado, reloj inyectable y cierre de recursos; conservar las rutas, el puerto habitual y `pnpm start`.
- [x] **T04. Implementar validación de entradas.** Validar objetos antes de desestructurar; rechazar payloads ausentes, `null`, arrays, PIN numérico y campos con tipos incorrectos (los campos adicionales se ignoran). Exigir `/^[0-9]{4}$/`, normalizar el nick y comprobar su longitud Unicode sin coerciones.
- [x] **T05. Proteger los manejadores.** Verificar el callback de confirmación antes de mutar estado y descartar solicitudes que lo requieran si falta. Capturar errores inesperados y responder `ERROR_INTERNO` sin exponer detalles internos.

**Verificación:** los validadores se prueban sin iniciar sockets; dos instancias del servidor no comparten partidas; entradas malformadas no provocan caídas ni mutaciones.

**Evidencia de fase 1:** T01–T05 verificadas con `pnpm test` (25 pruebas), `node --check` y una comprobación en Chrome sin interfaz: creación de partida, PIN desconocido, nick normalizado, unión, pregunta, respuesta, contador y botones bloqueados, sin errores JavaScript. El protocolo y la configuración adoptada están en [protocol.md](./protocol.md). Se adaptaron ambos clientes para enviar los nuevos payloads y esperar confirmaciones. T28 se adelantó parcialmente al configurar el script de pruebas; la dependencia de desarrollo y las comprobaciones de fases posteriores siguen pendientes.

## Fase 2. Sesiones y pertenencia a partidas

**Dependencias:** T01–T05. **Archivos:** `src/game-service.js`, `server.js`, `public/js/player.js`.

- [x] **T06. Modelar jugadores por identidad del servidor.** Usar un `Map` por `playerId` generado en el servidor y asociar la conexión mediante `socket.data.playerId` y `socket.data.gamePin`.
- [x] **T07. Validar y hacer repetible la unión.** Comprobar PIN, nick y existencia de la partida. Repetir una solicitud de unión en la misma conexión debe devolver el mismo jugador y sesión, sin duplicar registros ni notificaciones, incluso si se perdió el primer acuse.
- [x] **T08. Crear y recuperar sesiones.** Generar tokens secretos con `node:crypto`, guardarlos en `sessionStorage` y validarlos mediante `reanudar_sesion`. No registrar tokens en logs ni aceptar una identidad solo porque el navegador envía un `playerId`.
- [x] **T09. Limitar asociaciones activas.** Mantener una conexión activa por sesión e invalidar la anterior al reanudar. Rechazar el cambio de partida de una sesión existente y permitir comenzar otra explícitamente desde el formulario.
- [x] **T10. Verificar pertenencia en cada respuesta.** Exigir coincidencia entre el PIN solicitado, la sesión de la conexión y el registro del jugador. No considerar suficientes el PIN ni la pertenencia a una room.

**Verificación:** la unión repetida no duplica jugadores; una sesión válida recupera su identidad; conexiones ajenas, tokens falsos y sesiones de otra partida no pueden responder.

**Evidencia de fase 2:** T06–T10 verificadas con `pnpm test` (41 pruebas), `node --check` y Chrome sin interfaz. Se comprobaron uniones concurrentes, acuse inicial ignorado, asociación mediante `socket.data`, recuperación sin duplicados, tokens falsos o ajenos, revocación de la conexión anterior y pertenencia independiente de las rooms. En el navegador se verificaron recarga, reconexión, recuperación desde otra pestaña, inicio explícito de otra sesión y descarte de almacenamiento corrupto. Los contratos están actualizados en [protocol.md](./protocol.md). La recuperación del cliente adelanta parte de T25; el estado definitivo de preguntas, plazos y respuestas sigue pendiente de las fases 3–5.

## Fase 3. Preguntas y plazos controlados por el servidor

**Dependencias:** T06–T10. **Archivos:** `src/game-service.js`, `server.js`, `public/js/host.js`, `public/js/player.js` y `public/host.html`.

- [x] **T11. Modelar el ciclo de partida.** Incorporar estados `lobby`, `en_curso` y `finalizada`, preguntas por ID, referencia a la activa y respuestas por jugador dentro de cada pregunta.
- [x] **T12. Autorizar al profesor y proteger PIN existentes.** Comprobar `hostSocketId` al iniciar o publicar preguntas. Rechazar la creación con un PIN ocupado sin sobrescribir la partida y mostrar el rechazo en el panel.
- [x] **T13. Validar y abrir preguntas.** Exigir título y cuatro opciones no vacías, generar un ID y registrar apertura y cierre desde el servidor. Emitir `recibir_pregunta` con `{ preguntaId, titulo, opciones, cierraEn }` después de guardar el estado.
- [x] **T14. Comprobar la ventana de respuesta.** Para respuestas nuevas, exigir pregunta activa y abierta y `ahora < cierraEn`. Rechazar respuestas anteriores al inicio, de otro ID y recibidas exactamente al cierre o después.
- [x] **T15. Gestionar temporizadores.** Cerrar y emitir `pregunta_cerrada` al vencer el plazo. Cancelar temporizadores sustituidos y verificar el ID en sus callbacks. Comprobar también la hora al recibir respuestas aunque el temporizador se retrase.

**Verificación:** un profesor ajeno no cambia la partida; el reloj del cliente no controla el plazo; un temporizador antiguo no cierra una pregunta nueva.

**Evidencia de fase 3:** T11–T15 verificadas con `pnpm test` (65 pruebas), `node --check` y Chrome sin interfaz. Las pruebas cubren ciclo de partida, profesor ajeno incluso dentro de la room, PIN ocupado sin perder datos, publicación antes del inicio, preguntas inválidas sin sustituir la activa, IDs antiguos, apertura y cierre exactos, callbacks adelantados, retrasados y sustituidos, notificación única de cierre y cancelación al cerrar la instancia. En Chrome se comprobó un profesor y dos jugadores, errores de PIN, entrega de pregunta, respuesta y contador, bloqueo de botones, cierre real de 20 segundos, reloj del navegador alterado, rechazo tardío, recarga cerrada y nueva pregunta, sin errores de JavaScript o del servidor. Los contratos y los nuevos códigos están en [protocol.md](./protocol.md). El indicador de apertura recuperado y los listeners de cierre adelantan parte de T22/T25/T26; la consulta completa, el contador confirmado, los reintentos y la limpieza al desconectarse el profesor siguen pendientes. `finalizarPartida` modela el estado final en el servicio; T27 conectará su ciclo de vida al transporte.

## Fase 4. Respuestas únicas y confirmadas

**Dependencias:** T11–T15. **Archivos:** `src/game-service.js`, `server.js`.

- [x] **T16. Validar opciones.** Exigir `Number.isInteger(respuestaSeleccionada)` y un índice dentro del array de opciones de la pregunta identificada. Rechazar strings, decimales, negativos y valores fuera de rango con `OPCION_INVALIDA`.
- [x] **T17. Implementar la deduplicación.** Tras validar solicitud, pertenencia y opción, buscar una respuesta previa por partida, pregunta y jugador. Devolver la aceptación guardada para la misma opción; rechazar cambios con `YA_RESPONDIO`. Conservar registros hasta finalizar la partida.
- [x] **T18. Registrar antes de confirmar.** Para una respuesta nueva, comprobar pregunta y plazo y guardar el resultado sin ningún `await` entre comprobación y registro. Confirmar después; ninguna solicitud rechazada debe modificar registros o contadores.
- [x] **T19. Notificar una sola vez al profesor.** Emitir `respuesta_recibida` únicamente para un registro nuevo, incluyendo pregunta, jugador, opción y total aceptado. Un reintento idéntico, incluso después del cierre, solo confirma la aceptación anterior.
- [x] **T20. Unificar rechazos.** Implementar los códigos del plan: `DATOS_INVALIDOS`, `PARTIDA_NO_EXISTE`, `NO_PERTENECE`, `SESION_INVALIDA`, `SIN_PREGUNTA_ACTIVA`, `PREGUNTA_INCORRECTA`, `PLAZO_CERRADO`, `OPCION_INVALIDA`, `YA_RESPONDIO` y `ERROR_INTERNO`. Responder una sola vez por solicitud.

**Verificación:** dos envíos simultáneos generan un registro y una notificación; perder el acuse y repetir no cambia la respuesta ni aumenta el contador.

**Evidencia de fase 4:** T16–T20 verificadas con `pnpm test` (81 pruebas), `node --check` y Chrome sin interfaz. Las pruebas cubren opciones inválidas, registro previo al acuse y a la notificación, duplicados idénticos o con otra opción, totales por pregunta, reintentos tras cierre o cambio de pregunta, recuperación de sesión y todos los códigos de rechazo. Se descarta un acuse real para provocar timeout y verificar que la aceptación guardada se recupera sin efectos duplicados. En Chrome, un profesor y dos jugadores comprobaron PIN desconocido, entrega de pregunta, respuestas y botones bloqueados, duplicados concurrentes, rechazo de cambios, timeout por acuse perdido, reintento tras cierre y recarga; quedaron dos registros y el contador en dos, sin errores de JavaScript o del servidor. `respuesta_recibida` incorpora `totalAceptado`; su consumo en el panel, los reintentos automáticos y la reconciliación completa siguen pendientes de T24–T26. Contratos actualizados en [protocol.md](./protocol.md).

## Fase 5. Interfaces, reconexión y limpieza

**Dependencias:** T16–T20. **Archivos:** `public/player.html`, `public/js/player.js`, `public/js/host.js`, `server.js` y estilos si son necesarios.

- [x] **T21. Ajustar el formulario.** Usar PIN de texto con `inputmode="numeric"`, patrón y longitud de cuatro caracteres. Aplicar al nick los límites recibidos y el mismo conteo Unicode del servidor; mostrar errores comprensibles.
- [x] **T22. Modelar la interfaz del jugador.** Mantener PIN confirmado, ID de pregunta y estados espera, pregunta abierta, enviando, aceptada y cerrada. Bloquear botones mientras se envía y después de la aceptación.
- [x] **T23. Esperar la confirmación real.** Enviar mediante `socket.timeout(...).emitWithAck(...)` (ack nativo con promesa) y mostrar «Respuesta aceptada» solo con `ok: true`. En un rechazo, mostrar el motivo y permitir otra selección únicamente cuando el estado confirmado lo autorice.
- [x] **T24. Gestionar confirmaciones pendientes.** Conservar pregunta y opción cuando vence el timeout; mostrar «Confirmación pendiente» y reintentar esa misma solicitud hasta el límite configurado. No habilitar otra opción sin reconciliar el estado ni aplicar un acuse antiguo a otra pregunta.
- [x] **T25. Recuperar el estado al reconectar.** Bloquear acciones al desconectar y evitar emisiones si `socket.connected` es falso. Reanudar la sesión y consultar pregunta, plazo y respuesta registrada antes de habilitar acciones o reintentar. Registrar listeners una sola vez, fuera de `connect`; no usar eventos `volatile` para respuestas.
- [x] **T26. Adaptar el panel del profesor.** Actualizar los emisores al protocolo nuevo, procesar confirmaciones y filtrar notificaciones por `preguntaId`. Sustituir `conteoRespuestas++` por el total aceptado enviado por el servidor y reiniciar la vista al cambiar de pregunta.
- [x] **T27. Limpiar el ciclo de vida.** Conservar sesiones y respuestas de jugadores desconectados hasta terminar la partida. Al desconectarse el profesor, finalizar, avisar y eliminar temporizadores, sesiones y datos. Si el servidor se reinicia, comunicar que la sesión ya no existe y volver al formulario.

**Verificación:** la interfaz distingue rechazo y falta de confirmación; reconectar no permite responder otra vez; cerrar la partida libera recursos y bloquea nuevas respuestas.

**Evidencia de fase 5:** T21–T27 verificadas con `pnpm test` (102 pruebas), `node --check` y Chrome sin interfaz. Las pruebas de interfaz ejecutan los scripts reales con DOM, sockets y almacenamiento controlados: validación Unicode, doble clic, rechazo con motivo, tres intentos de la misma opción, consulta tras agotar reintentos, recuperación tras recarga y desconexión, acuses antiguos, eventos durante la recuperación, cierre y contador confirmado. Las pruebas del servicio y transporte verifican `consultar_estado`, aceptación propia, pertenencia, aviso de finalización y eliminación de temporizadores, sesiones, asociaciones y rooms sin afectar otras partidas. En Chrome, un profesor y dos jugadores comprobaron formulario Unicode, PIN desconocido, respuesta, rechazo reconciliado, pérdida real de tres acuses, reintentos limitados, recarga, cambio de pregunta, contador, reconexión, cierre, desconexión del profesor y reinicio del servidor; no se detectaron errores JavaScript ni del servidor. Se usan acknowledgements nativos mediante `emitWithAck`, equivalente con promesa al callback de T23. Contratos y comportamiento actualizados en [protocol.md](./protocol.md).

## Fase 6. Pruebas y cierre

**Dependencias:** añadir pruebas desde T04; completar la verificación conjunta después de T27.

- [x] **T28. Preparar pruebas automatizadas.** Añadir `socket.io-client` como dependencia de desarrollo, actualizar el lockfile y configurar `pnpm test` con `node --test`. Usar `node:test` y `node:assert/strict`.
- [x] **T29. Probar validadores.** Crear `test/validators.test.js` con payloads ausentes, `null`, arrays, tipos incorrectos, PIN de longitud/formato inválido y nick vacío, espacios, Unicode y longitudes 1/32/33. Incluir opciones inválidas y campos requeridos ausentes.
- [x] **T30. Probar reglas de partidas.** Crear `test/game-service.test.js` para pertenencia, estados, IDs antiguos, opciones, cambios de pregunta y duplicados. Con reloj inyectado, verificar antes del cierre, exactamente al cierre y después, así como callbacks de temporizadores sustituidos.
- [x] **T31. Probar eventos reales.** Crear `test/socket-events.test.js` con profesor y jugadores en ambos namespaces: uniones repetidas, PIN ocupado, profesor ajeno, falta de callback, respuesta sin registro y PIN de otra partida. Verificar acuses, ausencia de mutaciones en rechazos y conteos únicos.
- [x] **T32. Probar fallos de comunicación.** Simular acuse perdido, reintento después del cierre, dos envíos simultáneos, cambio de opción y reconexión con token válido, falso o ajeno. Comprobar invalidación de la conexión anterior y que una recuperación no duplique respuestas.
- [x] **T33. Cerrar recursos de pruebas.** Usar puertos efímeros, registrar listeners antes de emitir y cerrar clientes, servidores y temporizadores al terminar cada prueba. Evitar esperas largas o supuestos sobre tiempos exactos de red.
- [x] **T34. Ejecutar la verificación final.** Ejecutar `pnpm test` y `node --check` en los archivos JavaScript modificados. Con `pnpm start`, probar un profesor y dos jugadores: unión, PIN desconocido, pregunta, respuesta, doble clic, cierre y reconexión; revisar las consolas.
- [x] **T35. Documentar el resultado.** Registrar en `docs/` el protocolo adoptado, configuración final y comportamiento de sesiones y errores. Marcar las tareas completadas con evidencia de sus pruebas y comprobar que no quedan criterios pendientes.

**Verificación:** las pruebas pasan, terminan sin recursos abiertos y la prueba manual reproduce el comportamiento confirmado por el servidor.

**Evidencia de fase 6:** `socket.io-client@4.8.4` añadido como dependencia de desarrollo, lockfile actualizado y pruebas de integración migradas a su importación pública. `pnpm install --frozen-lockfile` correcto; 102 pruebas aprobadas con salida normal del proceso; sintaxis correcta en los 15 archivos JavaScript. Se revisaron los casos existentes de T29–T32 y el uso de puertos efímeros, listeners previos a la emisión, hooks de limpieza y reloj manual de T33. Chrome sin interfaz, contra el servidor iniciado con `pnpm start`, verificó un profesor y dos jugadores, PIN desconocido, pregunta, doble clic, aceptación, bloqueo, contador, reconexión, recarga, nueva pregunta, cierre real de 20 segundos, rechazo tardío y finalización sin errores JavaScript ni del servidor. El servidor y el perfil temporal se cerraron al terminar. Matriz de criterios y evidencia en [verification.md](./verification.md).

## Trazabilidad con las especificaciones

| Requisito de `specs.md` | Tareas principales | Pruebas |
|---|---|---|
| Tipos, formato del PIN y longitud del nick | T01, T04, T07, T21 | T29, T31 |
| Una respuesta por jugador y pregunta | T06–T09, T17–T19, T22, T24 | T30–T32 |
| Pregunta activa y plazo abierto | T11, T13–T15, T18, T25 | T30, T32 |
| Pertenencia a `gamePin` | T06–T10 | T31, T32 |
| Índice de opción válido | T02, T16 | T29, T30 |
| Confirmación y rechazo sin contabilizar | T05, T18–T20, T23–T26 | T31, T32, T34 |

## Criterio de finalización

Todas las tareas están verificadas, las cinco reglas se aplican en el servidor, los rechazos no alteran el estado y los reintentos no duplican registros ni conteos. Ambas interfaces muestran el estado confirmado y el protocolo final queda documentado.
