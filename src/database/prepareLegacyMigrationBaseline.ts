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
];

const LEGACY_CORE_MIGRATION_COUNT = 11;

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

const hasColumns = async (client: typeof Client, columns: string[][]) => {
    for (const [ tableName, columnName ] of columns) {
        if (!await columnExists(client, tableName, columnName)) {
            return false;
        }
    }

    return true;
};

const hasTables = async (client: typeof Client, tables: string[]) => {
    for (const tableName of tables) {
        if (!await tableExists(client, tableName)) {
            return false;
        }
    }

    return true;
};

const findLegacyMigrationsAlreadyReflected = async (client: typeof Client) => {
    const requiredTables = [
        'users',
        'component_workloads',
        'components',
        'component_logs',
        'component_drafts',
    ];

    const requiredColumns = [
        [ 'users', 'role' ],
        [ 'users', 'is_user_active' ],
        [ 'users', 'is_deleted' ],
        [ 'components', 'component_draft_id' ],
        [ 'component_drafts', 'component_id' ],
        [ 'component_logs', 'component_draft_id' ],
    ];

    if (!await hasTables(client, requiredTables) || !await hasColumns(client, requiredColumns)) {
        return [] as LegacyMigration[];
    }

    const reflectedMigrations = LEGACY_BASELINE_MIGRATIONS.slice(0, LEGACY_CORE_MIGRATION_COUNT);

    if (await hasColumns(client, [
        [ 'component_logs', 'version_code' ],
        [ 'component_logs', 'official_program' ],
        [ 'component_logs', 'official_syllabus' ],
    ])) {
        reflectedMigrations.push(LEGACY_BASELINE_MIGRATIONS[11]);
    }

    if (await hasTables(client, [ 'component_public_shares' ]) && await hasColumns(client, [
        [ 'users', 'signature_hash' ],
        [ 'users', 'signature_updated_at' ],
        [ 'components', 'academic_level' ],
        [ 'component_drafts', 'academic_level' ],
    ])) {
        reflectedMigrations.push(LEGACY_BASELINE_MIGRATIONS[12]);
    }

    if (await hasTables(client, [ 'component_relations' ])) {
        reflectedMigrations.push(LEGACY_BASELINE_MIGRATIONS[13]);
    }

    if (await hasColumns(client, [
        [ 'components', 'referencesBasic' ],
        [ 'components', 'referencesComplementary' ],
        [ 'component_drafts', 'referencesBasic' ],
        [ 'component_drafts', 'referencesComplementary' ],
    ])) {
        reflectedMigrations.push(LEGACY_BASELINE_MIGRATIONS[14]);
    }

    if (await hasColumns(client, [
        [ 'component_workloads', 'student_extension' ],
        [ 'component_workloads', 'teacher_extension' ],
        [ 'component_workloads', 'module_extension' ],
    ])) {
        reflectedMigrations.push(LEGACY_BASELINE_MIGRATIONS[15]);
    }

    if (await indexExists(client, 'UQ_component_logs_approval_agreement_number_normalized')) {
        reflectedMigrations.push(LEGACY_BASELINE_MIGRATIONS[16]);
    }

    if (await hasColumns(client, [
        [ 'users', 'signature_file_key' ],
        [ 'users', 'signature_file_provider' ],
        [ 'users', 'signature_file_content_type' ],
        [ 'users', 'signature_file_size' ],
        [ 'users', 'signature_file_hash' ],
    ])) {
        reflectedMigrations.push(LEGACY_BASELINE_MIGRATIONS[17]);
    }

    if (await hasTables(client, [ 'user_invite_short_links' ])) {
        reflectedMigrations.push(LEGACY_BASELINE_MIGRATIONS[18]);
    }

    if (await hasTables(client, [ 'departments' ]) && await hasColumns(client, [
        [ 'components', 'department_id' ],
        [ 'component_drafts', 'department_id' ],
    ])) {
        reflectedMigrations.push(LEGACY_BASELINE_MIGRATIONS[19]);
    }

    if (await indexExists(client, 'UQ_users_email_not_deleted')) {
        reflectedMigrations.push(LEGACY_BASELINE_MIGRATIONS[20]);
    }

    if (await hasTables(client, [ 'component_curriculum_contexts' ])) {
        reflectedMigrations.push(LEGACY_BASELINE_MIGRATIONS[21]);
    }

    return reflectedMigrations;
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

        const reflectedMigrations = await findLegacyMigrationsAlreadyReflected(client);
        if (reflectedMigrations.length === 0) {
            console.log('[migration-baseline] Existing schema does not match legacy baseline; TypeORM will run migrations normally.');
            return;
        }

        await client.query('BEGIN');

        for (const migration of reflectedMigrations) {
            await client.query(
                `INSERT INTO "migrations" ("timestamp", "name")
                 SELECT $1::bigint, $2::varchar
                 WHERE NOT EXISTS (
                     SELECT 1
                     FROM "migrations"
                     WHERE "timestamp" = $1::bigint
                       AND "name" = $2::varchar
                 )`,
                [ migration.timestamp, migration.name ]
            );
        }

        await client.query('COMMIT');
        console.log(`[migration-baseline] Registered ${reflectedMigrations.length} legacy migrations already reflected in the schema.`);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        await client.end();
    }
};
