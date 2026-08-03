import { LEGACY_BASELINE_MIGRATIONS } from '../database/prepareLegacyMigrationBaseline';

describe('legacy migration baseline', () => {
    it('should baseline only migrations that predate the current business fixes', () => {
        const migrationNames = LEGACY_BASELINE_MIGRATIONS.map((migration) => migration.name);

        expect(migrationNames).toContain('standardizeCoursesAndSemester1782100000000');
        expect(migrationNames).not.toContain('renamePmccToMechatronics1782200000000');
        expect(migrationNames).not.toContain('deriveSemestersFromCurriculumContexts1782300000000');
    });
});
