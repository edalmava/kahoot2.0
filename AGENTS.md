# Repository Guidelines

## Idioma de las respuestas

Todas las respuestas al usuario deben darse en español.

## Project Structure & Module Organization

- `server.js` runs the CommonJS Express server, serves static files, and handles Socket.IO events. Active games live in the `partidasActivas` in-memory map.
- `public/host.html` and `public/player.html` provide the teacher and student interfaces.
- `public/js/host.js` and `public/js/player.js` handle browser interactions through the `/host` and `/player` Socket.IO namespaces.
- `public/css/style.css` contains shared styling. Keep browser assets under `public/`.
- `package.json` defines dependencies and scripts; `pnpm-lock.yaml` records dependency versions. No test directory currently exists.

## Build, Test, and Development Commands

Run commands from the repository root:

- `pnpm install --frozen-lockfile`: install dependencies from the committed lockfile.
- `pnpm start`: run `node server.js` on port 3000. Open `http://localhost:3000/host-panel` and `http://localhost:3000/play`.
- `pnpm test`: currently exits with an error because the test script is a placeholder.
- `node --check server.js`: check server JavaScript syntax; use the same command for each browser script you change.

There is no build pipeline or automatic reload; restart the server after server-side edits.

## Coding Style & Naming Conventions

Use two-space indentation, semicolons, and `const` unless reassignment requires `let`. Keep server modules in CommonJS and browser code in plain JavaScript. Follow existing camelCase variables, Spanish UI copy, and hyphenated DOM IDs/classes such as `pantalla-lobby`. Socket events use Spanish snake_case, such as `unirse_a_partida`; update producers and consumers together when changing event names or payloads. No formatter or linter is configured.

## Testing Guidelines

No automated testing framework or coverage threshold is configured. Before submitting changes, create a game in the host page, join from a separate player tab, start the question, and confirm a submitted answer increments the host counter and disables player buttons. Also verify that an unknown PIN displays an error. Check browser and server consoles for failures.

## Commit & Pull Request Guidelines

This checkout has no Git metadata, so existing commit conventions cannot be verified. Use short, imperative commit subjects, such as `Fix player answer submission`. Keep changes focused. PRs should explain behavior changes, list verification performed, link related issues when available, and include screenshots for visible UI changes.
