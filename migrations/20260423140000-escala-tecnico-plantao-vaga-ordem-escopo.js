'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('escala', 'tipo', {
      type: Sequelize.STRING(24),
      allowNull: false,
      defaultValue: 'veterinario',
      comment: 'veterinario | tecnico',
    });

    await queryInterface.removeIndex('plantao', 'plantao_escala_data_uk');
    await queryInterface.addColumn('plantao', 'vaga_indice', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: '0 ou 1 em escalas técnicas (duas vagas/dia); 0 em escalas de veterinário',
    });
    await queryInterface.addIndex('plantao', ['escala_id', 'data_referencia', 'vaga_indice'], {
      unique: true,
      name: 'plantao_escala_data_vaga_uk',
    });

    await queryInterface.addColumn('ordem_servidor', 'escopo', {
      type: Sequelize.STRING(24),
      allowNull: false,
      defaultValue: 'veterinario',
      comment: 'veterinario | tecnico — ordens globais independentes',
    });

    await queryInterface.removeIndex('ordem_servidor', 'ordem_servidor_usuario_uk');
    await queryInterface.removeIndex('ordem_servidor', 'ordem_servidor_ordem_uk');
    await queryInterface.addIndex('ordem_servidor', ['escopo', 'usuario_id'], {
      unique: true,
      name: 'ordem_servidor_escopo_usuario_uk',
    });
    await queryInterface.addIndex('ordem_servidor', ['escopo', 'ordem'], {
      unique: true,
      name: 'ordem_servidor_escopo_ordem_uk',
    });

    const now = new Date();
    await queryInterface.sequelize.query(
      `
      INSERT INTO ordem_servidor (usuario_id, ordem, escopo, "createdAt", "updatedAt")
      SELECT u.id, ROW_NUMBER() OVER (ORDER BY u.nome) AS ordem, 'tecnico', :now, :now
      FROM usuario u
      INNER JOIN usuario_papel up ON up.usuario_id = u.id
      INNER JOIN papel p ON p.id = up.papel_id AND p.nome = 'Técnico'
      WHERE u.ativo = true
      `,
      { replacements: { now } },
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`DELETE FROM ordem_servidor WHERE escopo = 'tecnico'`);

    await queryInterface.removeIndex('ordem_servidor', 'ordem_servidor_escopo_ordem_uk');
    await queryInterface.removeIndex('ordem_servidor', 'ordem_servidor_escopo_usuario_uk');
    await queryInterface.addIndex('ordem_servidor', ['usuario_id'], {
      unique: true,
      name: 'ordem_servidor_usuario_uk',
    });
    await queryInterface.addIndex('ordem_servidor', ['ordem'], {
      unique: true,
      name: 'ordem_servidor_ordem_uk',
    });
    await queryInterface.removeColumn('ordem_servidor', 'escopo');

    await queryInterface.removeIndex('plantao', 'plantao_escala_data_vaga_uk');
    await queryInterface.removeColumn('plantao', 'vaga_indice');
    await queryInterface.addIndex('plantao', ['escala_id', 'data_referencia'], {
      unique: true,
      name: 'plantao_escala_data_uk',
    });

    await queryInterface.removeColumn('escala', 'tipo');
  },
};
