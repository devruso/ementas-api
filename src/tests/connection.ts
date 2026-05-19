import { createConnection, getConnection, getConnectionManager, getConnectionOptions } from 'typeorm';
/* eslint-disable */
require('dotenv').config();
/* eslint-enable */

const connection = {
    async create(){
        process.env.DB_NAME = process.env.DB_TEST_NAME;

        await getConnectionOptions()
            .then(async options => {
                const resolvedDatabase = process.env.DB_TEST_NAME || (options as any).database;

                if (!resolvedDatabase) {
                    throw new Error('DB_TEST_NAME nao definido para execucao de testes de integracao.');
                }

                const testConnection = await createConnection({
                    ...(options as any),
                    database: resolvedDatabase,
                    dropSchema: false,
                    migrationsRun: false,
                    synchronize: false,
                } as any);

                const setupQueryRunner = testConnection.createQueryRunner();
                await setupQueryRunner.connect();
                await setupQueryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
                await setupQueryRunner.release();

                await testConnection.synchronize(true);

                return testConnection;
            })
            .catch(err => {
                console.log(err);
                throw err;
            });
    },

    async close(){
        const manager = getConnectionManager();

        if (!manager.has('default')) {
            return;
        }

        const defaultConnection = manager.get('default');

        if (defaultConnection.isConnected) {
            await defaultConnection.close();
        }
    },

    async clear(){
        const activeConnection = getConnection();
        const entities = activeConnection.entityMetadatas;
        const tableNames = entities.map(entity => `"${entity.tableName}"`).join(', ');

        if (!tableNames) {
            return;
        }

        const clearQueryRunner = activeConnection.createQueryRunner();

        await clearQueryRunner.connect();
        await clearQueryRunner.query(`TRUNCATE ${tableNames} RESTART IDENTITY CASCADE;`);
        await clearQueryRunner.release();
    },
};
export default connection;