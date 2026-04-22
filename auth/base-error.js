class ApiBaseError extends Error {
  constructor(description) {
    super(description);

    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ErroObjetoNaoEncontrado';
    this.statusCode = 400;
    this.isOperational = true;
    Error.captureStackTrace(this);
  }
}

module.exports = ApiBaseError;
