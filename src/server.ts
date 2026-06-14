import { createConnection, getConnectionOptions } from 'typeorm';
import { app } from './app';
import { runStartupBootstrapImportIfNeeded } from './services/StartupBootstrapService';

const PORT = process.env.PORT || 3333;
const env = process.env.NODE_ENV || 'local';

getConnectionOptions()
    .then(async options => {
        const extra = env !== 'local' ? { ssl: { rejectUnauthorized: false } } : undefined;
        return createConnection({ ...options, extra, migrationsRun: true });
    })
    .then(connection => {
        console.log(`DB connection is UP? ${connection.isConnected}`);

        runStartupBootstrapImportIfNeeded()
            .catch((error) => {
                console.log('[startup-bootstrap] failed:', error);
            });

        app.listen(PORT, () => {
            console.log(`Server running on PORT ${PORT}`);
        });
    })
    .catch(err => {
        console.log(err);
        throw err;
    });

process.on('unhandledRejection', (err) => console.log(err));

process.on('uncaughtException', (err) => console.log(err));
