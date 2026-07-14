import crypto from 'crypto';
import { getCustomRepository } from 'typeorm';

import { AcademicLevel } from '../interfaces/AcademicLevel';
import { UserRole } from '../interfaces/UserRole';
import { User } from '../entities/User';
import { ComponentRepository } from '../repositories/ComponentRepository';
import { UserRepository } from '../repositories/UserRepository';
import { CrawlerService, ImportComponentsSummary } from './CrawlerService';

const AUTO_IMPORT_FLAG = 'true';

type BootstrapSource = 'sigaa-public' | 'sigaa-snapshot' | 'siac';

const DEFAULT_SIGAA_SOURCE_IDS: Record<AcademicLevel, string[]> = {
    [AcademicLevel.GRADUATION]: ['1114'],
    [AcademicLevel.MASTERS]: ['1820'],
    [AcademicLevel.DOCTORATE]: [],
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const isUfbaEmail = (email: string) => /@ufba\.br$/i.test(email);

const parseBoolean = (rawValue?: string) => String(rawValue || '').trim().toLowerCase() === AUTO_IMPORT_FLAG;

const getConfiguredSource = (): BootstrapSource => {
    const rawSource = String(process.env.BOOTSTRAP_IMPORT_SOURCE || 'sigaa-public').trim().toLowerCase();
    if (rawSource === 'siac') {
        return 'siac';
    }

    if (rawSource === 'sigaa-snapshot') {
        return 'sigaa-snapshot';
    }

    return 'sigaa-public';
};

const getConfiguredAcademicLevel = (): AcademicLevel | 'all' => {
    const rawLevel = String(process.env.BOOTSTRAP_SIGAA_ACADEMIC_LEVEL || 'all')
        .trim()
        .toLowerCase();

    if (rawLevel === 'all' || rawLevel === 'todos') {
        return 'all';
    }

    if (Object.values(AcademicLevel).includes(rawLevel as AcademicLevel)) {
        return rawLevel as AcademicLevel;
    }

    return 'all';
};

const getConfiguredSigaaSourceType = (): 'department' | 'program' => {
    const rawType = String(process.env.BOOTSTRAP_SIGAA_SOURCE_TYPE || 'department').trim().toLowerCase();
    return rawType === 'program' ? 'program' : 'department';
};

const parsePositiveInt = (rawValue?: string) => {
    const parsed = Number(String(rawValue || '').trim());

    if (!Number.isFinite(parsed) || parsed <= 0) {
        return undefined;
    }

    return Math.floor(parsed);
};

const parseSourceIdList = (...rawValues: Array<string | undefined>) => {
    const tokens = rawValues
        .flatMap((rawValue) => String(rawValue || '')
            .split(/[,\n;\r]+/)
            .map((entry) => entry.trim()))
        .filter(Boolean);

    return Array.from(new Set(tokens));
};

const getConfiguredBootstrapSigaaRequestTimeoutMs = () => parsePositiveInt(
    process.env.BOOTSTRAP_SIGAA_REQUEST_TIMEOUT_MS
);

const getConfiguredSigaaSnapshotPath = () => String(
    process.env.BOOTSTRAP_SIGAA_SNAPSHOT_PATH || '/app/bootstrap-data/sigaa-bootstrap.snapshot.json'
).trim();

const getConfiguredGlobalSigaaSourceIds = () => parseSourceIdList(
    process.env.BOOTSTRAP_SIGAA_SOURCE_IDS,
    process.env.BOOTSTRAP_SIGAA_SOURCE_ID
);

const getConfiguredSigaaSourceIdsByLevel = () => ({
    [AcademicLevel.GRADUATION]: parseSourceIdList(
        process.env.BOOTSTRAP_SIGAA_SOURCE_IDS_GRADUACAO,
        process.env.BOOTSTRAP_SIGAA_SOURCE_ID_GRADUACAO
    ),
    [AcademicLevel.MASTERS]: parseSourceIdList(
        process.env.BOOTSTRAP_SIGAA_SOURCE_IDS_MESTRADO,
        process.env.BOOTSTRAP_SIGAA_SOURCE_ID_MESTRADO
    ),
    [AcademicLevel.DOCTORATE]: parseSourceIdList(
        process.env.BOOTSTRAP_SIGAA_SOURCE_IDS_DOUTORADO,
        process.env.BOOTSTRAP_SIGAA_SOURCE_ID_DOUTORADO
    ),
});

const resolveSigaaSourceIdsForLevel = (
    level: AcademicLevel,
    globalSourceIds: string[],
    sourceIdsByLevel: Record<AcademicLevel, string[]>
) => sourceIdsByLevel[level].length > 0
    ? sourceIdsByLevel[level]
    : globalSourceIds.length > 0
        ? globalSourceIds
        : DEFAULT_SIGAA_SOURCE_IDS[level];

const mergeImportSummaries = (target: ImportComponentsSummary, partial: ImportComponentsSummary) => {
    target.requested += partial.requested;
    target.created += partial.created;
    target.skippedExisting += partial.skippedExisting;
    target.reconciled = (target.reconciled || 0) + (partial.reconciled || 0);
    target.failed += partial.failed;
    target.failures.push(...(partial.failures || []));

    Object.entries(partial.failureCategories || {}).forEach(([key, value]) => {
        target.failureCategories[key] = (target.failureCategories[key] || 0) + Number(value || 0);
    });
};

const getPasswordHash = (password: string) => crypto.createHmac('sha256', password).digest('hex');

const ensureBootstrapSuperAdmin = async () => {
    const userRepository = getCustomRepository(UserRepository);
    const configuredEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || process.env.SUPER_ADMIN_EMAIL;

    if (!configuredEmail) {
        throw new Error('BOOTSTRAP_ADMIN_EMAIL (or SUPER_ADMIN_EMAIL) is required for startup bootstrap import.');
    }

    const email = normalizeEmail(configuredEmail);

    if (!isUfbaEmail(email)) {
        throw new Error('Startup bootstrap requires an UFBA institutional e-mail for BOOTSTRAP_ADMIN_EMAIL.');
    }

    const name = String(process.env.BOOTSTRAP_ADMIN_NAME || 'Bootstrap Super Admin').trim();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    const existing = await userRepository.findOne({ where: { email } });

    if (existing) {
        existing.name = existing.name || name;
        existing.role = UserRole.SUPER_ADMIN;
        existing.isDeleted = false;
        existing.isUserActive = true;

        if (password) {
            existing.password = getPasswordHash(password);
        }

        const saved = await userRepository.save(existing);
        return saved.id;
    }

    const fallbackPassword = password || crypto.randomBytes(12).toString('base64url');
    const created = await userRepository.save(
        userRepository.create({
            name,
            email,
            password: getPasswordHash(fallbackPassword),
            role: UserRole.SUPER_ADMIN,
            isDeleted: false,
            isUserActive: true,
        } as User)
    );

    return created.id;
};

export const runStartupBootstrapImportIfNeeded = async () => {
    const isEnabled = parseBoolean(process.env.BOOTSTRAP_IMPORT_ON_EMPTY_DB);

    if (!isEnabled) {
        console.log('[startup-bootstrap] skipped: BOOTSTRAP_IMPORT_ON_EMPTY_DB is not true.');
        return;
    }

    const componentRepository = getCustomRepository(ComponentRepository);
    const componentCount = await componentRepository.count();

    if (componentCount > 0) {
        console.log(`[startup-bootstrap] skipped: components table already has ${componentCount} row(s).`);
        return;
    }

    const source = getConfiguredSource();
    const userId = await ensureBootstrapSuperAdmin();
    const crawlerService = new CrawlerService();

    console.log(`[startup-bootstrap] running source=${source} because components table is empty.`);

    if (source === 'siac') {
        const cdCurso = String(process.env.BOOTSTRAP_SIAC_CD_CURSO || '').trim();
        const nuPerCursoInicial = String(process.env.BOOTSTRAP_SIAC_NU_PER_CURSO_INICIAL || '').trim();

        if (!cdCurso || !nuPerCursoInicial) {
            throw new Error('BOOTSTRAP_SIAC_CD_CURSO and BOOTSTRAP_SIAC_NU_PER_CURSO_INICIAL are required for source=siac.');
        }

        const summary = await crawlerService.importComponentsFromSiac(userId, cdCurso, nuPerCursoInicial);
        console.log('[startup-bootstrap] import summary:', summary);
        return;
    }

    const configuredLevel = getConfiguredAcademicLevel();
    const globalSourceIds = getConfiguredGlobalSigaaSourceIds();
    const sourceIdsByLevel = getConfiguredSigaaSourceIdsByLevel();

    if (source === 'sigaa-snapshot') {
        const snapshotPath = getConfiguredSigaaSnapshotPath();
        const summary = await crawlerService.importComponentsFromSigaaSnapshot(userId, snapshotPath, {
            academicLevel: configuredLevel,
            globalSourceIds,
            sourceIdsByLevel,
        });
        console.log('[startup-bootstrap] import summary:', summary);
        return;
    }

    const sourceType = getConfiguredSigaaSourceType();
    const bootstrapSigaaRequestTimeoutMs = getConfiguredBootstrapSigaaRequestTimeoutMs();

    if (configuredLevel === 'all') {
        const levels: AcademicLevel[] = [AcademicLevel.GRADUATION, AcademicLevel.MASTERS, AcademicLevel.DOCTORATE];
        const combinedSummary: ImportComponentsSummary = {
            source: 'sigaa-public',
            requested: 0,
            created: 0,
            skippedExisting: 0,
            reconciled: 0,
            failed: 0,
            failures: [] as string[],
            failureCategories: {} as Record<string, number>,
        };

        for (const level of levels) {
            const resolvedSourceIds = resolveSigaaSourceIdsForLevel(level, globalSourceIds, sourceIdsByLevel);

            for (const resolvedSourceId of resolvedSourceIds) {
                const partial = await crawlerService.importComponentsFromSigaaPublic(
                    userId,
                    sourceType,
                    resolvedSourceId,
                    level,
                    { requestTimeoutMs: bootstrapSigaaRequestTimeoutMs }
                );
                mergeImportSummaries(combinedSummary, partial);
            }
        }

        combinedSummary.failures = Array.from(new Set(combinedSummary.failures));
        console.log('[startup-bootstrap] import summary:', combinedSummary);
        return;
    }

    const sourceIds = resolveSigaaSourceIdsForLevel(configuredLevel, globalSourceIds, sourceIdsByLevel);

    if (sourceIds.length === 0) {
        throw new Error(`Nenhum sourceId SIGAA configurado para o nivel ${configuredLevel}.`);
    }

    const combinedSummary: ImportComponentsSummary = {
        source: 'sigaa-public',
        requested: 0,
        created: 0,
        skippedExisting: 0,
        reconciled: 0,
        failed: 0,
        failures: [],
        failureCategories: {},
    };

    for (const sourceId of sourceIds) {
        const partial = await crawlerService.importComponentsFromSigaaPublic(
            userId,
            sourceType,
            sourceId,
            configuredLevel,
            { requestTimeoutMs: bootstrapSigaaRequestTimeoutMs }
        );
        mergeImportSummaries(combinedSummary, partial);
    }

    combinedSummary.failures = Array.from(new Set(combinedSummary.failures));
    console.log('[startup-bootstrap] import summary:', combinedSummary);
};
