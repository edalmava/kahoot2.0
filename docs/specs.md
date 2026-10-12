# Especificaciones del cliente y validaciones del servidor

## Objetivo

El cliente permite unirse a una partida y enviar respuestas. El servidor debe validar cada solicitud y decidir si la acepta, independientemente de las comprobaciones realizadas en el navegador.

## 1. Validación del PIN y del nombre

- Validar la estructura y los tipos de los datos recibidos antes de procesarlos.
- `gamePin` debe ser una cadena de exactamente cuatro dígitos, conforme al formato actual de las partidas.
- `nickname` debe ser una cadena. El servidor debe eliminar espacios al inicio y al final, rechazar nombres vacíos y comprobar su longitud contra los límites permitidos.
- Los límites mínimo y máximo del nombre deben definirse explícitamente en la configuración del servidor y reflejarse en el cliente.
- Rechazar solicitudes inválidas e informar al cliente del motivo.

## 2. Una respuesta por jugador y pregunta

- Registrar en el servidor las respuestas aceptadas, asociadas a la partida, la pregunta y el jugador identificado por su conexión.
- Aceptar como máximo una respuesta por jugador para cada pregunta, incluso si envía solicitudes repetidas.
- Una respuesta duplicada no debe modificar la respuesta registrada ni incrementar el contador del profesor.
- El cliente debe bloquear los botones mientras espera confirmación y después de que la respuesta sea aceptada.

## 3. Pregunta activa y plazo de respuesta

- Aceptar respuestas únicamente si la partida tiene una pregunta activa y su plazo de respuesta permanece abierto.
- Controlar el plazo con el reloj del servidor.
- Rechazar respuestas anteriores al inicio, posteriores al cierre o correspondientes a otra pregunta. La solicitud debe identificar la pregunta que el jugador está respondiendo.

## 4. Pertenencia a la partida

- Comprobar que la partida indicada por `gamePin` existe y que el jugador está registrado en ella.
- Usar la identidad de la conexión para esta comprobación; enviar un PIN válido no acredita pertenencia.

## 5. Validez de la opción

- `indiceOpcion` debe ser un número entero dentro del rango de opciones de la pregunta activa: `0 <= indiceOpcion < opciones.length`.
- Rechazar valores de otro tipo o fuera de rango.
- En el código actual, este valor viaja en el campo `respuestaSeleccionada`; mantener la correspondencia entre cliente y servidor.

## Confirmación al cliente

El servidor debe confirmar la aceptación o comunicar el rechazo de cada respuesta. El cliente debe mostrar el resultado de esa confirmación antes de afirmar que la respuesta fue aceptada. Una solicitud rechazada no debe contabilizarse.
