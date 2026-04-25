import pg from 'pg';

export function createDatabase(pgConfig) {
  const pool = new pg.Pool({
    host: pgConfig.host,
    port: pgConfig.port,
    database: pgConfig.database,
    user: pgConfig.user,
    password: pgConfig.password,
    ssl: pgConfig.ssl,
  });

  return {
    query: (text, params) => pool.query(text, params),
    close: () => pool.end(),
  };
}
