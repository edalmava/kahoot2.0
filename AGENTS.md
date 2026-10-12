# Repository Guidelines

## Idioma de las respuestas

Todas las respuestas al usuario deben darse en español.

## Especificaciones, planes y tareas

El directorio `docs/` contiene las especificaciones del proyecto, los planes para desarrollarlas y las tareas para implementarlas:

- `docs/specs.md`: requisitos y comportamiento esperado.
- `docs/plan.md`: plan de implementación y criterios de aceptación.
- `docs/tasks.md`: tareas ordenadas y seguimiento de su ejecución.
- `docs/protocol.md`: contratos de eventos, configuración adoptada y alcance implementado.

Antes de iniciar una implementación, consultar estos documentos y mantener los cambios alineados con las especificaciones, el plan y las tareas correspondientes.

## Continuidad entre sesiones

Las **fases 1–6 de `docs/tasks.md` (T01–T35) están completadas y verificadas**. No quedan tareas pendientes de este plan ni debe reiniciarse su implementación. Antes de abordar nuevos cambios, consultar `docs/specs.md`, `docs/plan.md`, `docs/tasks.md`, `docs/protocol.md` y `docs/verification.md`.

La fase 6 incorpora `socket.io-client` como dependencia de desarrollo y lo usa en las pruebas de integración. Última verificación: 102 pruebas aprobadas con `pnpm test`, instalación con `pnpm install --frozen-lockfile`, sintaxis de los 15 archivos JavaScript y flujo completo en Chrome contra `pnpm start`, con cierre real de 20 segundos, reconexión, recarga y finalización sin errores de consola. La evidencia y trazabilidad están en `docs/verification.md`. El alcance sigue siendo memoria en un único proceso e identidad por sesión de jugador.

## Project Structure & Module Organization

- `server.js` exports `createGameServer`, serves static files, and registers Socket.IO events; direct execution starts port 3000. `src/` contains configuration, validators, request handling, and the game service with isolated in-memory state. `test/*.test.js` contains automated tests.
- `public/host.html` and `public/player.html` provide the teacher and student interfaces.
- `public/js/host.js` and `public/js/player.js` handle browser interactions through the `/host` and `/player` Socket.IO namespaces.
- `public/css/style.css` contains shared styling. Keep browser assets under `public/`.
- `package.json` defines dependencies and scripts; `pnpm-lock.yaml` records dependency versions.

## Build, Test, and Development Commands

Run commands from the repository root:

- `pnpm install --frozen-lockfile`: install dependencies from the committed lockfile.
- `pnpm start`: run `node server.js` on port 3000. Open `http://localhost:3000/host-panel` and `http://localhost:3000/play`.
- `pnpm test`: run the Node.js test runner for validators, handlers, game service, routes, and Socket.IO events.
- `node --check server.js`: check server JavaScript syntax; use the same command for each browser script you change.

There is no build pipeline or automatic reload; restart the server after server-side edits.

## Coding Style & Naming Conventions

Use two-space indentation, semicolons, and `const` unless reassignment requires `let`. Keep server modules in CommonJS and browser code in plain JavaScript. Follow existing camelCase variables, Spanish UI copy, and hyphenated DOM IDs/classes such as `pantalla-lobby`. Socket events use Spanish snake_case, such as `unirse_a_partida`; update producers and consumers together when changing event names or payloads. No formatter or linter is configured.

## Testing Guidelines

Use `node:test` and `node:assert/strict`; name tests `test/*.test.js`. Integration tests use the `socket.io-client` development dependency, ephemeral ports, and cleanup hooks. Browser script tests use the controlled DOM/socket fixture in `test-support/browser-client.js`; deadlines use `test-support/manual-clock.js`. Run `pnpm test` with Node.js 24; no coverage threshold is configured. Before submitting changes, verify host/player joining, question delivery, answer counts, disabled buttons, and unknown-PIN errors. Check browser and server consoles for failures. See `docs/verification.md` for the final acceptance evidence.

## Commit & Pull Request Guidelines

Git history uses a `feat:` prefix. Use concise, imperative subjects, such as `fix: Validate player answer payloads`. Keep changes focused. PRs should explain behavior changes, list verification performed, link related issues when available, and include screenshots for visible UI changes.
