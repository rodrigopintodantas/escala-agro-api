const ApiBaseError = require('../auth/base-error');

function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message = 'Erro interno no servidor';

  console.error(err);

  if (err instanceof ApiBaseError) {
    message = err.message;
    statusCode = err.statusCode;
  } else if (err.name === 'SequelizeForeignKeyConstraintError') {
    message = 'Erro ao tentar excluir um registro associado a outro';
    statusCode = 400;
  } else if (err.name === 'SequelizeUniqueConstraintError') {
    message = 'Já existe um registro com os dados informados';
    statusCode = 400;
  } else if (err.name === 'ValidationError') {
    message = 'Erro na validação dos dados';
    statusCode = 400;
  } else if (err.name === 'CastError') {
    message = 'Identificador inválido';
    statusCode = 400;
  } else if (err.code === 'ECONNREFUSED') {
    message = 'Serviço indisponível';
    statusCode = 503;
  } else if (err.name === 'UnauthorizedError') {
    message = 'Token expirado ou inválido';
    statusCode = 401;
  }

  if (res) {
    res.status(statusCode).json({
      message,
      ...(process.env.NODE_ENV === 'local' && { stack: err.stack }),
    });
  }
}

module.exports = errorHandler;
