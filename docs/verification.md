# Verificación final de las seis fases

T01–T35 completadas. Esta revisión reúne la evidencia de aceptación de [specs.md](./specs.md), [plan.md](./plan.md) y [tasks.md](./tasks.md). El contrato y los valores finales están en [protocol.md](./protocol.md).

## Entorno y comandos

Verificación realizada con Windows, Node.js 24.12.0 y pnpm 12.11.2. Servidor Socket.IO 4.8.4 y dependencia de desarrollo `socket.io-client` 4.8.4 según el lockfile. Las pruebas de integración usan la importación pública `require('socket.io-client')`.

| Comprobación | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | Correcta; lockfile actualizado y sin cambios requeridos |
| `pnpm test` (`node --test`) | 102 pruebas aprobadas; 0 fallidas, canceladas, omitidas o pendientes |
| `node --check` | Correcto en los 15 archivos JavaScript de servidor, `src/`, `public/js/`, `test/` y `test-support/` |
| `pnpm start` | Servidor iniciado en el puerto 3000; rutas de profesor y jugador accesibles |
| Chrome sin interfaz, tres páginas reales | Flujo completo aprobado; sin errores JavaScript ni del servidor |

El proceso de pruebas terminó normalmente, sin una opción que forzara la salida. El servidor usado para Chrome se detuvo al terminar y el puerto 3000 quedó libre. Chrome utilizó un perfil temporal aislado que se eliminó después de cerrar el proceso.

## Cobertura de criterios

La revisión comprueba los casos exigidos por el plan; no representa una medición porcentual de cobertura de líneas.

| Criterio | Evidencia automatizada |
|---|---|
| Estructura, tipos, PIN textual de cuatro dígitos y campos requeridos | `test/validators.test.js`: payload ausente, `null`, arrays, tipos incorrectos, formato, longitud y ceros iniciales. `test/socket-events.test.js`: rechazo sin mutaciones |
| Nick normalizado, Unicode y límites 1/32/33 | `test/validators.test.js` y `test/browser-client.test.js`: mismo conteo por puntos de código en servidor y formulario |
| Pertenencia acreditada por conexión y sesión | `test/game-service.test.js` y `test/socket-events.test.js`: jugador sin registro, PIN ajeno, room insuficiente y conexión revocada |
| Opciones enteras dentro del rango | Validadores para tipos; servicio y eventos para valores negativos o fuera de las opciones de la pregunta |
| Pregunta activa y plazo del servidor | Servicio y eventos: antes del inicio, IDs antiguos, apertura, justo antes del cierre, cierre exacto, después y callback retrasado |
| Temporizadores seguros | Servicio y eventos: callback adelantado, sustituido o cancelado, cierre único y limpieza de recursos |
| Una respuesta por jugador y pregunta | Servicio y eventos: solicitudes simultáneas idénticas o distintas, `YA_RESPONDIO`, registro previo al acuse, una notificación y total por pregunta |
| Pérdida de acuse y deduplicación | Eventos: descarte de un acuse real, timeout y recuperación tras el cierre. Interfaz: tres intentos de la misma opción, consulta posterior y límite conservado al recargar |
| Recuperación autorizada | Servicio y eventos: tokens válidos, falsos o ajenos, invalidación de conexión anterior, conservación de respuesta y ausencia de registros duplicados |
| Confirmación y rechazo visibles | `test/browser-client.test.js`: doble clic, aceptación solo confirmada, rechazo con motivo, consulta antes de habilitar, acuses antiguos ignorados y acciones bloqueadas sin conexión |
| Contador del profesor | Eventos e interfaz: `totalAceptado`, filtrado por pregunta, reinicio a cero y confirmación tardía que no sobrescribe el conteo |
| Autorización y ciclo de vida | Servicio y eventos: profesor ajeno, PIN ocupado, desconexión del profesor, aviso de finalización, liberación del PIN, sesiones, asociaciones y rooms |
| Errores controlados | `test/request-handler.test.js` y eventos: callback ausente, errores internos sin detalles, contrato uniforme y como máximo un acuse |
| Aislamiento y cierre de pruebas | Fábricas independientes, puertos efímeros, listeners registrados antes de emitir y hooks `t.after`/`afterEach` que cierran clientes, servidores y servicios |

Los plazos de las pruebas automatizadas se controlan con `test-support/manual-clock.js`; los timeouts de red son límites de espera, no supuestos sobre una latencia exacta. Los scripts de navegador se ejecutan con el fixture de `test-support/browser-client.js`. Estos casos se complementan con Chrome real.

## Verificación del navegador

La fase 6 ejecutó Chrome sin interfaz mediante DevTools contra el servidor iniciado con `pnpm start`. Se usaron las páginas reales `/host-panel` y `/play`, la configuración habitual y el reloj real del servidor:

1. Crear una partida y abrir dos páginas de jugador; comprobar el rechazo visible de un PIN desconocido.
2. Unir a Ana y Luis y comprobar dos participantes en el panel.
3. Iniciar la pregunta; hacer doble clic en una opción de Ana y comprobar un solo envío, aceptación y botones bloqueados.
4. Desconectar y reconectar a Ana, y después recargar su página: conserva identidad y respuesta aceptada.
5. Responder con Luis y comprobar que el total confirmado del profesor es dos.
6. Publicar otra pregunta mediante el evento autorizado del profesor: el contador vuelve a cero y las opciones se habilitan.
7. Esperar el cierre real de 20 segundos. Comprobar el bloqueo de ambos jugadores y `PLAZO_CERRADO` ante una solicitud tardía, sin cambiar el contador.
8. Desconectar al profesor: ambos jugadores reciben la finalización, vuelven al formulario y eliminan sus credenciales locales.
9. Revisar las consolas: sin excepciones JavaScript ni errores del servidor. Cerrar navegador y servidor.

La comprobación previa de fase 5 también cubrió en Chrome tres acuses perdidos con reintentos limitados, rechazo reconciliado, acuse antiguo y reinicio del servidor. La fase 6 vuelve a ejecutar sus casos automatizados y comprueba el flujo final con la configuración normal.

Para una revisión visual, ejecutar `pnpm start`, abrir una página de profesor y dos de jugador y reproducir unión, errores, pregunta, doble clic, respuesta, cierre y reconexión. La publicación de preguntas adicionales se admite en el protocolo; el panel actual conserva la pregunta fija prevista por el proyecto.

## Resultado y alcance

Las cinco reglas de las especificaciones se aplican en el servidor. Los rechazos no modifican respuestas ni contadores; los reintentos recuperan la aceptación anterior sin duplicar efectos, y las interfaces muestran el estado confirmado. No quedan criterios pendientes del plan.

Se mantiene el alcance acordado: memoria en un solo proceso e identidad por sesión. Finalizar la partida o reiniciar el servidor invalida sus sesiones. Persistencia, despliegue con varias instancias y cuentas personales siguen fuera de este plan.
