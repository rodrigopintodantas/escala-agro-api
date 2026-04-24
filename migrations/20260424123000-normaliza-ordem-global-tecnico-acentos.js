'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      WITH ordenado AS (
        SELECT
          u.id AS usuario_id,
          ROW_NUMBER() OVER (
            ORDER BY
              translate(
                lower(u.nome),
                'áàâãäéèêëíìîïóòôõöúùûüç',
                'aaaaaeeeeiiiiooooouuuuc'
              ),
              lower(u.nome),
              u.id
          ) AS nova_ordem
        FROM usuario u
        INNER JOIN usuario_papel up ON up.usuario_id = u.id
        INNER JOIN papel p ON p.id = up.papel_id
        WHERE u.ativo = true
          AND p.nome = 'Técnico'
      )
      UPDATE ordem_servidor
         SET ordem = ordem + 100000,
             "updatedAt" = NOW()
       WHERE escopo = 'tecnico';

      WITH ordenado AS (
        SELECT
          u.id AS usuario_id,
          ROW_NUMBER() OVER (
            ORDER BY
              translate(
                lower(u.nome),
                'áàâãäéèêëíìîïóòôõöúùûüç',
                'aaaaaeeeeiiiiooooouuuuc'
              ),
              lower(u.nome),
              u.id
          ) AS nova_ordem
        FROM usuario u
        INNER JOIN usuario_papel up ON up.usuario_id = u.id
        INNER JOIN papel p ON p.id = up.papel_id
        WHERE u.ativo = true
          AND p.nome = 'Técnico'
      )
      UPDATE ordem_servidor os
         SET ordem = o.nova_ordem,
             "updatedAt" = NOW()
        FROM ordenado o
       WHERE os.usuario_id = o.usuario_id
         AND os.escopo = 'tecnico';
    `);
  },

  async down() {
    // Sem rollback: reordenação é corretiva e idempotente.
  },
};
