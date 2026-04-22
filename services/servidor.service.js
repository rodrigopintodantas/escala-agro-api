const { QueryTypes } = require('sequelize');
const models = require('../models');
const sequelize = models.sequelize;

const ServidorService = {
  /**
   * Saldo = quantidade de plantões (previsto ou confirmado) por veterinário.
   */
  listarSaldoVeterinarios: async () => {
    const rows = await sequelize.query(
      `
      SELECT u.id, u.nome, u.login, COALESCE(COUNT(p.id), 0)::int AS saldo
      FROM usuario u
      INNER JOIN usuario_papel up ON up.usuario_id = u.id
      INNER JOIN papel pa ON pa.id = up.papel_id AND pa.nome = 'Veterinario'
      LEFT JOIN plantao p ON p.usuario_id = u.id AND p.status IN ('previsto', 'confirmado')
      WHERE u.ativo = true
      GROUP BY u.id, u.nome, u.login
      ORDER BY u.nome ASC
      `,
      { type: QueryTypes.SELECT },
    );
    return rows;
  },
};

module.exports = ServidorService;
