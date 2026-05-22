'use strict';

/**
 * Dados espelhados das migrations de seed de usuários de desenvolvimento.
 * @see migrations/20260415000005-seed-usuario-admin-demo.js
 * @see migrations/20260416100003-veterinarios-ficticios.js
 * @see migrations/20260423130001-tecnico-ficticios-seed.js
 * @see migrations/20260428102000-patch-senha-usuarios-admins.js
 */

const SENHA_PADRAO_DESENVOLVIMENTO = '123456';

const administradores = [
  {
    nome: 'Administrador',
    login: 'admin',
    email: 'admin@escala.local',
    cargo: 'Admin',
    papel: 'ADMIN',
  },
  {
    nome: 'Eduardo',
    login: 'eduardo',
    email: 'eduardo@escala.local',
    cargo: 'Admin',
    papel: 'ADMIN',
  },
  {
    nome: 'Letícia',
    login: 'leticia',
    email: 'leticia@escala.local',
    cargo: 'Admin',
    papel: 'ADMIN',
  },
];

/** @see migrations/20260416100003-veterinarios-ficticios.js */
const veterinarios = [
  { nome: 'Ana Paula Ferreira', login: 'ana', email: 'vet1@escala.local', cargo: 'Veterinário', papel: 'Veterinário' },
  { nome: 'Bruno Costa Lima', login: 'bru', email: 'vet2@escala.local', cargo: 'Veterinário', papel: 'Veterinário' },
  { nome: 'Carla Mendes Rocha', login: 'car', email: 'vet3@escala.local', cargo: 'Veterinário', papel: 'Veterinário' },
  { nome: 'Daniel Souza Alves', login: 'dan', email: 'vet4@escala.local', cargo: 'Veterinário', papel: 'Veterinário' },
  { nome: 'Elisa Nunes Prado', login: 'eli', email: 'vet5@escala.local', cargo: 'Veterinário', papel: 'Veterinário' },
  { nome: 'Felipe Duarte Gomes', login: 'fel', email: 'vet6@escala.local', cargo: 'Veterinário', papel: 'Veterinário' },
  { nome: 'Gabriela Ramos Dias', login: 'gab', email: 'vet7@escala.local', cargo: 'Veterinário', papel: 'Veterinário' },
  { nome: 'Henrique Lopes Vieira', login: 'hen', email: 'vet8@escala.local', cargo: 'Veterinário', papel: 'Veterinário' },
];

/** @see migrations/20260423130001-tecnico-ficticios-seed.js */
const tecnicos = [
  { nome: 'Álvaro Mendes Tavares', login: 'tec_alvaro', email: 'tec_alvaro@escala.local', cargo: 'Técnico', papel: 'Técnico' },
  { nome: 'Amanda Rocha Prado', login: 'tec_amanda', email: 'tec_amanda@escala.local', cargo: 'Técnico', papel: 'Técnico' },
  { nome: 'Bianca Ferreira Lima', login: 'tec_bianca', email: 'tec_bianca@escala.local', cargo: 'Técnico', papel: 'Técnico' },
  { nome: 'Bernardo Alves Souza', login: 'tec_bernardo', email: 'tec_bernardo@escala.local', cargo: 'Técnico', papel: 'Técnico' },
  { nome: 'Camila Dias Nunes', login: 'tec_camila', email: 'tec_camila@escala.local', cargo: 'Técnico', papel: 'Técnico' },
  { nome: 'Carlos Eduardo Vieira', login: 'tec_carlos', email: 'tec_carlos@escala.local', cargo: 'Técnico', papel: 'Técnico' },
  { nome: 'Denise Lopes Ramos', login: 'tec_denise', email: 'tec_denise@escala.local', cargo: 'Técnico', papel: 'Técnico' },
  { nome: 'Diego Martins Costa', login: 'tec_diego', email: 'tec_diego@escala.local', cargo: 'Técnico', papel: 'Técnico' },
  { nome: 'Elisa Duarte Gomes', login: 'tec_elisa', email: 'tec_elisa@escala.local', cargo: 'Técnico', papel: 'Técnico' },
  { nome: 'Eduardo Silva Prado', login: 'tec_eduardo', email: 'tec_eduardo@escala.local', cargo: 'Técnico', papel: 'Técnico' },
  { nome: 'Fernanda Costa Oliveira', login: 'tec_fernanda', email: 'tec_fernanda@escala.local', cargo: 'Técnico', papel: 'Técnico' },
  { nome: 'Fábio Henrique Dias', login: 'tec_fabio', email: 'tec_fabio@escala.local', cargo: 'Técnico', papel: 'Técnico' },
  { nome: 'Gabriela Santos Rocha', login: 'tec_gabriela', email: 'tec_gabriela@escala.local', cargo: 'Técnico', papel: 'Técnico' },
  { nome: 'Gustavo Lima Alves', login: 'tec_gustavo', email: 'tec_gustavo@escala.local', cargo: 'Técnico', papel: 'Técnico' },
  { nome: 'Helena Vieira Mendes', login: 'tec_helena', email: 'tec_helena@escala.local', cargo: 'Técnico', papel: 'Técnico' },
  { nome: 'Hugo Duarte Nunes', login: 'tec_hugo', email: 'tec_hugo@escala.local', cargo: 'Técnico', papel: 'Técnico' },
];

function listarTodos() {
  return [...administradores, ...veterinarios, ...tecnicos];
}

module.exports = {
  SENHA_PADRAO_DESENVOLVIMENTO,
  administradores,
  veterinarios,
  tecnicos,
  listarTodos,
};
