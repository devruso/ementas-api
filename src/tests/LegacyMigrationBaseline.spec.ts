import { LEGACY_BASELINE_MIGRATIONS } from '../database/prepareLegacyMigrationBaseline';

describe('legacy migration baseline', () => {
    it('should baseline schema migrations but always rerun idempotent data repairs', () => {
        const migrationNames = LEGACY_BASELINE_MIGRATIONS.map((migration) => migration.name);

        expect(migrationNames).toContain('addComponentCurriculumContexts1781900000000');
        expect(migrationNames).not.toContain('backfillComponentDepartments1782000000000');
        expect(migrationNames).not.toContain('standardizeCoursesAndSemester1782100000000');
        expect(migrationNames).not.toContain('renamePmccToMechatronics1782200000000');
        expect(migrationNames).not.toContain('deriveSemestersFromCurriculumContexts1782300000000');
    });
});
