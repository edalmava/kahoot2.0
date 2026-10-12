const CONFIG = Object.freeze({
  port: 3000,
  pinLength: 4,
  nicknameMinLength: 1,
  nicknameMaxLength: 32,
  questionDurationMs: 20000,
  ackTimeoutMs: 5000,
  maxRetries: 2,
  optionCount: 4
});

const { port, ...clientConfig } = CONFIG;
const CLIENT_CONFIG = Object.freeze(clientConfig);

module.exports = { CONFIG, CLIENT_CONFIG };
