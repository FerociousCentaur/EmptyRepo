const knex = require('knex');
const path = require('path');

const dbConfigs = {
  sqlite: {
    client: 'sqlite3',
    connection: {
      filename: process.env.DB_PATH
    },
    useNullAsDefault: true,
    pool: {
      afterCreate: (conn, cb) => {
        conn.run('PRAGMA foreign_keys = ON', cb);
      }
    }
  },
  postgres: {
    client: 'pg',
    connection: process.env.DATABASE_URL
  }
};

const db = knex(dbConfigs[process.env.DB_TYPE]);

module.exports = db;