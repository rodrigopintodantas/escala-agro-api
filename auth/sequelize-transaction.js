const db = require('../models');
const errorHandler = require('./error-handler');

async function sequelizeTransaction(callback) {
  const transaction = await db.sequelize.transaction();
  try {
    const result = await callback(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    errorHandler(error);
    throw error;
  }
}

module.exports = sequelizeTransaction;
