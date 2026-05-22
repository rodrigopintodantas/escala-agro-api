'use strict';

const { administradores } = require('./usuarios-desenvolvimento');

const SENHA_PADRAO_PRODUCAO = '123456';

function servidor(nome, login, papel, cargo) {
  const prefixo = papel === 'Veterinário' ? 'vet' : 'tec';
  return {
    nome,
    login,
    email: `${prefixo}_${login}@escala.local`,
    cargo,
    papel,
  };
}

/** Veterinários — ordem de cadastro conforme lista oficial. */
const veterinarios = [
  servidor('Marcelo Vaske', 'marcelo_vaske', 'Veterinário', 'Veterinário'),
  servidor('Daniella Dianese Alves De Moraes', 'daniella_dianese', 'Veterinário', 'Veterinário'),
  servidor('Érica Garcia De Araújo Pinto', 'erica_garcia', 'Veterinário', 'Veterinário'),
  servidor('Gabriela Curvello', 'gabriela_curvello', 'Veterinário', 'Veterinário'),
  servidor('Glenda Roberta Silva Moura', 'glenda_roberta', 'Veterinário', 'Veterinário'),
  servidor('Janaína Bitencourt Licurgo', 'janaina_bitencourt', 'Veterinário', 'Veterinário'),
  servidor('Lorena Bastos Da Costa Soares', 'lorena_bastos', 'Veterinário', 'Veterinário'),
  servidor('Luciana Lana Rigueira', 'luciana_lana', 'Veterinário', 'Veterinário'),
  servidor('Priscilla Pereira Moura', 'priscilla_pereira', 'Veterinário', 'Veterinário'),
  servidor('Roberto Celidônio Alonso', 'roberto_celidonio', 'Veterinário', 'Veterinário'),
  servidor('Letícia Siqueira Leal', 'leticia_siqueira', 'Veterinário', 'Veterinário'),
  servidor('Lucas Andrade Mendes', 'lucas_andrade', 'Veterinário', 'Veterinário'),
  servidor('Cosme Nogueira Da Silva', 'cosme_nogueira', 'Veterinário', 'Veterinário'),
];

/** Técnicos — ordem de cadastro conforme lista oficial. */
const tecnicos = [
  servidor('Adaílton Soares Guimarães', 'adailton_soares', 'Técnico', 'Técnico'),
  servidor('Amâncio Rufino De Mello', 'amancio_rufino', 'Técnico', 'Técnico'),
  servidor('Carlos Vinicius Dos Santos Oliveira', 'carlos_vinicius', 'Técnico', 'Técnico'),
  servidor('Claudemar Jorge Fereira', 'claudemar_jorge', 'Técnico', 'Técnico'),
  servidor('Douglas Barbosa Lucas', 'douglas_barbosa', 'Técnico', 'Técnico'),
  servidor('Fabrícia Vieira Dos Santos Galeno', 'fabricia_vieira', 'Técnico', 'Técnico'),
  servidor('Félix Da Silva Santarém', 'felix_santarem', 'Técnico', 'Técnico'),
  servidor('Francisco Macilon Dantas', 'francisco_macilon', 'Técnico', 'Técnico'),
  servidor('Gabriel De Oliveira Ferreira', 'gabriel_oliveira', 'Técnico', 'Técnico'),
  servidor('Jefferson Lemos Moreira Alves', 'jefferson_lemos', 'Técnico', 'Técnico'),
  servidor('João Victor Teles Da Silva', 'joao_victor_teles', 'Técnico', 'Técnico'),
  servidor('Jose Barros De Morais', 'jose_barros', 'Técnico', 'Técnico'),
  servidor('Márbylla Souza Bezerra Ramalho', 'marbylla_souza', 'Técnico', 'Técnico'),
  servidor('Marcelo Antonio Alves Da Rocha', 'marcelo_antonia_rocha', 'Técnico', 'Técnico'),
  servidor('Marcondes Ribeiro Palmeira', 'marcondes_ribeiro', 'Técnico', 'Técnico'),
  servidor('Maria Claudinéia De Rezende', 'maria_claudineia', 'Técnico', 'Técnico'),
  servidor('Marilene De S. C. Lopes Da Silva', 'marilene_lopes', 'Técnico', 'Técnico'),
  servidor('Paulo Sérgio Cavalcante Fernandes', 'paulo_sergio', 'Técnico', 'Técnico'),
  servidor('Rosemar Dos Santos', 'rosemar_santos', 'Técnico', 'Técnico'),
  servidor('Valdecy Rodrigues', 'valdecy_rodrigues', 'Técnico', 'Técnico'),
  servidor('Victor Afonso Gomes', 'victor_afonso', 'Técnico', 'Técnico'),
  servidor('Walber Ferreira De Oliveira', 'walber_ferreira', 'Técnico', 'Técnico'),
];

function listarTodos() {
  return [...administradores, ...veterinarios, ...tecnicos];
}

module.exports = {
  SENHA_PADRAO_PRODUCAO,
  administradores,
  veterinarios,
  tecnicos,
  listarTodos,
};
