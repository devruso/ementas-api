import 'reflect-metadata';
import { createConnection, getConnectionOptions } from 'typeorm';
import { UserInviteService } from '../services/UserInviteService';

const run = async () => {
    const env = process.env.NODE_ENV || 'local';
    const options = await getConnectionOptions();
    const extra = env !== 'local' ? { ssl: { rejectUnauthorized: false } } : undefined;

    const connection = await createConnection({
        ...(options as any),
        extra,
        migrationsRun: false,
    });

    try {
        const deletedCount = await new UserInviteService().cleanupExpiredShortLinks();
        console.log(`[invite-shortlink-cleanup] deleted=${deletedCount}`);
    } finally {
        await connection.close();
    }
};

run().catch((error) => {
    console.log('[invite-shortlink-cleanup] failed:', error);
    process.exitCode = 1;
});
