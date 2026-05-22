const sequelizeTransaction = require('../auth/sequelize-transaction');
const { executarCargaEscalaUsuarios } = require('./carga-escala-usuarios.service');
const {
  TABELAS_RESET,
  contarTabela,
  normalizarOrdemGlobalTecnico,
  reconstruirOrdemServidorInicial,
} = require('./sistema-ordem.service');
const {
  SENHA_PADRAO_DESENVOLVIMENTO,
  listarTodos: listarUsuariosDesenvolvimento,
} = require('../scripts/dados/usuarios-desenvolvimento');
const {
  SENHA_PADRAO_PRODUCAO,
  listarTodos: listarUsuariosProducao,
} = require('../scripts/dados/usuarios-producao');

const SistemaService = {
  reiniciarTeste: async () => {
    const db = require('../models');
    return await sequelizeTransaction(async (t) => {
      const antes = {};
      for (const tabela of TABELAS_RESET) {
        antes[tabela] = await contarTabela(db.sequelize, tabela, t);
      }

      await db.sequelize.query(
        `TRUNCATE TABLE ${TABELAS_RESET.join(', ')} RESTART IDENTITY CASCADE`,
        { transaction: t },
      );

      await reconstruirOrdemServidorInicial(db.sequelize, t);
      await normalizarOrdemGlobalTecnico(db.sequelize, t);

      const ordemServidor = await contarTabela(db.sequelize, 'ordem_servidor', t);
      return {
        mensagem: 'Sistema reiniciado para testes com sucesso.',
        removidos: antes,
        ordemServidorRecriada: ordemServidor,
      };
    });
  },

  carregarDesenvolvimento: async () => {
    const db = require('../models');
    return executarCargaEscalaUsuarios(db.sequelize, {
      conjunto: 'desenvolvimento',
      definicoes: listarUsuariosDesenvolvimento(),
      senhaPadrao: SENHA_PADRAO_DESENVOLVIMENTO,
    });
  },

  carregarProducao: async () => {
    const db = require('../models');
    return executarCargaEscalaUsuarios(db.sequelize, {
      conjunto: 'producao',
      definicoes: listarUsuariosProducao(),
      senhaPadrao: SENHA_PADRAO_PRODUCAO,
    });
  },
};

module.exports = SistemaService;
module.exports.TABELAS_RESET = TABELAS_RESET;
module.exports.reconstruirOrdemServidorInicial = reconstruirOrdemServidorInicial;
module.exports.normalizarOrdemGlobalTecnico = normalizarOrdemGlobalTecnico;
