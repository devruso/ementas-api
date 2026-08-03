// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client } = require('pg');

type DatabaseOptions = {
    host?: unknown;
    port?: unknown;
    username?: unknown;
    password?: unknown;
    database?: unknown;
    url?: unknown;
    extra?: {
        ssl?: unknown;
    };
}

type LegacyMigration = {
    timestamp: number;
    name: string;
}

export const LEGACY_BASELINE_MIGRATIONS: LegacyMigration[] = [
    { timestamp: 1648448709449, name: 'init1648448709449' },
    { timestamp: 1648451921366, name: 'changes1648451921366' },
    { timestamp: 1648862942442, name: 'alterWorkloadIdInComponentTable1648862942442' },
    { timestamp: 1649067359896, name: 'fixDepartmentTypeOnComponentEntity1649067359896' },
    { timestamp: 1649073876568, name: 'uniqueCodeComponent1649073876568' },
    { timestamp: 1650309500580, name: 'newComponentFields1650309500580' },
    { timestamp: 1650499889265, name: 'addComponentDraftTable1650499889265' },
    { timestamp: 1650670423640, name: 'uniqueCodeComponentDraft1650670423640' },
    { timestamp: 1652465677648, name: 'userAddColumnRoleAndActive1652465677648' },
    { timestamp: 1652477664290, name: 'addComponentDraftIdToComponentLogTable1652477664290' },
    { timestamp: 1656268770924, name: 'addSoftDeleteColumn1656268770924' },
    { timestamp: 1772324400000, name: 'addOfficialVersionToComponentLog1772324400000' },
    { timestamp: 1772412000000, name: 'addGovernanceShareAndAcademicLevel1772412000000' },
    { timestamp: 1772528400000, name: 'addComponentRelationsTable1772528400000' },
    { timestamp: 1772532000000, name: 'addComponentReferenceSections1772532000000' },
    { timestamp: 1778050800000, name: 'addExtensionColumnsToComponentWorkloads1778050800000' },
    { timestamp: 1778122800000, name: 'addUniqueApprovalAgreementNumber1778122800000' },
    { timestamp: 1778700000000, name: 'addSignatureFileMetadataToUsers1778700000000' },
    { timestamp: 1779300000000, name: 'addUserInviteShortLinks1779300000000' },
    { timestamp: 1780900000000, name: 'addDepartmentsModule1780900000000' },
    { timestamp: 1781800000000, name: 'fixUniqueEmailConstraintForSoftDelete1781800000000' },
    { timestamp: 1781900000000, name: 'addComponentCurriculumContexts1781900000000' },
    { timestamp: 1782000000000, name: 'backfillComponentDepartments1782000000000' },
    { timestamp: 1782100000000, name: 'standardizeCoursesAndSemester1782100000000' },
];

const createLegacyBaselineClient = (options: DatabaseOptions) => new Client({
    connectionString: options.url,
    host: options.host,
    port: options.port,
    user: options.username,
    password: options.password,
    database: options.database,
    ssl: options.extra?.ssl,
});

const tableExists = async (client: typeof Client, tableName: string) => {
    const result = await client.query('SELECT to_regclass($1) IS NOT NULL AS "exists"', [ `public.${tableName}` ]);

    return Boolean(result.rows[0]?.exists);
};

const columnExists = async (client: typeof Client, tableName: string, columnName: string) => {
    const result = await client.query(
        `SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
              AND column_name = $2
        ) AS "exists"`,
        [ tableName, columnName ]
    );

    return Boolean(result.rows[0]?.exists);
};

const indexExists = async (client: typeof Client, indexName: string) => {
    const result = await client.query(
        `SELECT EXISTS (
            SELECT 1
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND indexname = $1
        ) AS "exists"`,
        [ indexName ]
    );

    return Boolean(result.rows[0]?.exists);
};

const hasLegacySchemaBaseline = async (client: typeof Client) => {
    const requiredTables = [
        'users',
        'component_workloads',
        'components',
        'component_logs',
        'component_drafts',
        'component_public_shares',
        'component_relations',
        'user_invite_short_links',
        'departments',
        'component_curriculum_contexts',
    ];

    const requiredColumns = [
        [ 'users', 'role' ],
        [ 'users', 'is_user_active' ],
        [ 'users', 'is_deleted' ],
        [ 'users', 'signature_file_key' ],
        [ 'components', 'component_draft_id' ],
        [ 'components', 'academic_level' ],
        [ 'components', 'department_id' ],
        [ 'components', 'referencesBasic' ],
        [ 'components', 'referencesComplementary' ],
        [ 'component_drafts', 'component_id' ],
        [ 'component_drafts', 'department_id' ],
        [ 'component_drafts', 'referencesBasic' ],
        [ 'component_drafts', 'referencesComplementary' ],
        [ 'component_logs', 'version_code' ],
        [ 'component_logs', 'official_program' ],
        [ 'component_logs', 'official_syllabus' ],
        [ 'component_logs', 'component_draft_id' ],
        [ 'component_workloads', 'student_extension' ],
        [ 'component_workloads', 'teacher_extension' ],
        [ 'component_workloads', 'module_extension' ],
    ];

    const requiredIndexes = [
        'UQ_users_email_not_deleted',
        'UQ_component_logs_approval_agreement_number_normalized',
        'UQ_departments_name_normalized',
    ];

    for (const requiredTable of requiredTables) {
        if (!await tableExists(client, requiredTable)) {
            return false;
        }
    }

    for (const [ tableName, columnName ] of requiredColumns) {
        if (!await columnExists(client, tableName, columnName)) {
            return false;
        }
    }

    for (const requiredIndex of requiredIndexes) {
        if (!await indexExists(client, requiredIndex)) {
            return false;
        }
    }

    return true;
};

export const prepareLegacyMigrationBaseline = async (options: DatabaseOptions) => {
    if (process.env.NODE_ENV === 'test' || process.env.DISABLE_LEGACY_MIGRATION_BASELINE === 'true') {
        return;
    }

    const client = createLegacyBaselineClient(options);
    await client.connect();

    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS "migrations" (
                "id" SERIAL NOT NULL,
                "timestamp" bigint NOT NULL,
                "name" character varying NOT NULL,
                CONSTRAINT "PK_8c82d7f526340ab734260ea46be" PRIMARY KEY ("id")
            )
        `);

        const migrationsCount = await client.query('SELECT COUNT(*)::int AS "total" FROM "migrations"');
        if (Number(migrationsCount.rows[0]?.total || 0) > 0) {
            return;
        }

        if (!await hasLegacySchemaBaseline(client)) {
            console.log('[migration-baseline] Existing schema does not match legacy baseline; TypeORM will run migrations normally.');
            return;
        }

        await client.query('BEGIN');

        for (const migration of LEGACY_BASELINE_MIGRATIONS) {
            await client.query(
                `INSERT INTO "migrations" ("timestamp", "name")
                 SELECT $1, $2
                 WHERE NOT EXISTS (
                     SELECT 1 FROM "migrations" WHERE "timestamp" = $1 AND "name" = $2
                 )`,
                [ migration.timestamp, migration.name ]
            );
        }

        await client.query('COMMIT');
        console.log(`[migration-baseline] Registered ${LEGACY_BASELINE_MIGRATIONS.length} legacy migrations.`);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        await client.end();
    }
};
