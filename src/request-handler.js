const { RequestError } = require('./errors');

function registerRequest(socket, event, validate, handle, logger = console) {
  socket.on(event, async (...args) => {
    const callback = args.at(-1);
    if (typeof callback !== 'function') return;
    let confirmado = false;
    const confirmar = (response) => {
      if (confirmado) return;
      confirmado = true;
      callback(response);
    };

    try {
      if (args.length !== 2) {
        throw new RequestError('DATOS_INVALIDOS', 'Se esperaba un objeto y una confirmación.');
      }
      const payload = validate(args[0]);
      const data = await handle(payload);
      confirmar({ ok: true, data });
    } catch (error) {
      if (error instanceof RequestError) {
        confirmar({ ok: false, error: { code: error.code, message: error.message } });
        return;
      }
      // No incluir payloads, identidades ni futuros tokens de sesión en los logs.
      logger.error(`Error interno al procesar ${event}.`);
      confirmar({
        ok: false,
        error: { code: 'ERROR_INTERNO', message: 'No se pudo procesar la solicitud.' }
      });
    }
  });
}

module.exports = { registerRequest };
