class RequestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RequestError';
    this.code = code;
  }
}

module.exports = { RequestError };
