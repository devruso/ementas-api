import crypto from 'crypto';
import { getCustomRepository } from 'typeorm';

import { AcademicLevel } from '../interfaces/AcademicLevel';
import { UserRole } from '../interfaces/UserRole';
import { User } from '../entities/User';
import { ComponentRepository } from '../repositories/ComponentRepository';
import { UserRepository } from '../repositories/UserRepository';
import { CrawlerService, ImportComponentsSummary } from './CrawlerService';

const AUTO_IMPORT_FLAG = 'true';

type BootstrapSource = 'sigaa-public' | 'siac';

const DEFAULT_SIGAA_SOURCE_IDS: Record<AcademicLevel, string> = {
    [AcademicLevel.GRADUATION]: '114',
    [AcademicLevel.MASTERS]: '1307',
    [AcademicLevel.DOCTORATE]: '1307',
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const isUfbaEmail = (email: string) => /@ufba\.br$/i.test(email);

const parseBoolean = (rawValue?: string) => String(rawValue || '').trim().toLowerCase() === AUTO_IMPORT_FLAG;

const getConfiguredSource = (): BootstrapSource => {
    const rawSource = String(process.env.BOOTSTRAP_IMPORT_SOURCE || 'sigaa-public').trim().toLowerCase();
    return rawSource === 'siac' ? 'siac' : 'sigaa-public';
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

const getConfiguredSigaaSourceIdsByLevel = () => ({
    [AcademicLevel.GRADUATION]: String(process.env.BOOTSTRAP_SIGAA_SOURCE_ID_GRADUACAO || '').trim(),
    [AcademicLevel.MASTERS]: String(process.env.BOOTSTRAP_SIGAA_SOURCE_ID_MESTRADO || '').trim(),
    [AcademicLevel.DOCTORATE]: String(process.env.BOOTSTRAP_SIGAA_SOURCE_ID_DOUTORADO || '').trim(),
});

const resolveSigaaSourceIdForLevel = (
    level: AcademicLevel,
    globalSourceId: string,
    sourceIdsByLevel: Record<AcademicLevel, string>
) => sourceIdsByLevel[level] || globalSourceId || DEFAULT_SIGAA_SOURCE_IDS[level];

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

    const sourceType = getConfiguredSigaaSourceType();
    const configuredLevel = getConfiguredAcademicLevel();
    const globalSourceId = String(process.env.BOOTSTRAP_SIGAA_SOURCE_ID || '').trim();
    const sourceIdsByLevel = getConfiguredSigaaSourceIdsByLevel();

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
            const resolvedSourceId = resolveSigaaSourceIdForLevel(level, globalSourceId, sourceIdsByLevel);
            const partial = await crawlerService.importComponentsFromSigaaPublic(userId, sourceType, resolvedSourceId, level);
            mergeImportSummaries(combinedSummary, partial);
        }

        combinedSummary.failures = Array.from(new Set(combinedSummary.failures));
        console.log('[startup-bootstrap] import summary:', combinedSummary);
        return;
    }

    const sourceId = resolveSigaaSourceIdForLevel(configuredLevel, globalSourceId, sourceIdsByLevel);
    const summary = await crawlerService.importComponentsFromSigaaPublic(userId, sourceType, sourceId, configuredLevel);
    console.log('[startup-bootstrap] import summary:', summary);
};
