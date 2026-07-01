import { UserInviteService } from './UserInviteService';

const defaultCleanupIntervalInMs = 6 * 60 * 60 * 1000;

const parseCleanupIntervalInMs = () => {
    const rawInterval = process.env.INVITE_SHORTLINK_CLEANUP_INTERVAL_MS;

    if (!rawInterval) {
        return defaultCleanupIntervalInMs;
    }

    const parsed = Number(rawInterval);

    if (!Number.isFinite(parsed) || parsed <= 0) {
        return defaultCleanupIntervalInMs;
    }

    return parsed;
};

export const startUserInviteShortLinkCleanupScheduler = () => {
    const intervalInMs = parseCleanupIntervalInMs();
    const userInviteService = new UserInviteService();

    const runCleanup = async () => {
        const deletedCount = await userInviteService.cleanupExpiredShortLinks();

        if (deletedCount > 0) {
            console.log(`[invite-shortlink-cleanup] removed ${deletedCount} expired rows`);
        }
    };

    void runCleanup().catch((error) => {
        console.log('[invite-shortlink-cleanup] startup cleanup failed:', error);
    });

    setInterval(() => {
        void runCleanup().catch((error) => {
            console.log('[invite-shortlink-cleanup] periodic cleanup failed:', error);
        });
    }, intervalInMs);
};
