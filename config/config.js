require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const getDatabaseConfig = () => {
  const isDocker =
    process.env.DOCKER_CONTAINER === 'true' ||
    process.env.DOCKER_CONTAINER === '1';

  const host = isDocker ? 'postgres' : process.env.DB_HOST || '127.0.0.1';
  const port = isDocker ? 5432 : parseInt(process.env.DB_PORT, 10) || 5432;

  return {
    username: process.env.DB_USER || 'escala',
    password: process.env.DB_PASSWORD || 'escala',
    database: process.env.DB_DATABASE || 'escala_agro',
    host,
    port,
    dialect: 'postgres',
  };
};

const sequelizeConfig = {
  development: getDatabaseConfig(),
  test: {
    dialect: 'sqlite',
    storage: ':memory:',
    logging: false,
  },
  production: getDatabaseConfig(),
  stage: getDatabaseConfig(),
};

const env = process.env.NODE_ENV || 'stage';
if (env === 'stage') {
  sequelizeConfig.development = getDatabaseConfig();
}

module.exports = sequelizeConfig;
