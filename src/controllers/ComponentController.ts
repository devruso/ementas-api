import { Request, Response } from 'express';
import { getAuthToken } from '../helpers/getAuthToken';

import { paginate } from '../helpers/paginate';
import { verifyAuthToken } from '../helpers/verifyAuthToken';
import { ComponentLogService } from '../services/ComponentLogService';
import { ComponentPublicShareService } from '../services/ComponentPublicShareService';
import { ComponentService } from '../services/ComponentService';
import { CrawlerService } from '../services/CrawlerService';
import { AcademicLevel } from '../interfaces/AcademicLevel';
import { SigaaImportJobService } from '../services/SigaaImportJobService';

const isUserAuthenticated = (authorization?: string) => {
    try {
        const authToken = getAuthToken(authorization);

        if (!authToken) return false;

        verifyAuthToken(authToken);

        return true;
    } catch {
        return false;
    }
};

const readSigaaSourceIdFromEnv = (level?: AcademicLevel) => {
    const globalSourceId = String(process.env.BOOTSTRAP_SIGAA_SOURCE_ID || '').trim();
    const defaultSourceIds: Record<AcademicLevel, string> = {
        [AcademicLevel.GRADUATION]: '114',
        [AcademicLevel.MASTERS]: '1307',
        [AcademicLevel.DOCTORATE]: '1307',
    };

    if (!level) {
        return globalSourceId;
    }

    const levelMap: Record<AcademicLevel, string> = {
        [AcademicLevel.GRADUATION]: String(process.env.BOOTSTRAP_SIGAA_SOURCE_ID_GRADUACAO || '').trim(),
        [AcademicLevel.MASTERS]: String(process.env.BOOTSTRAP_SIGAA_SOURCE_ID_MESTRADO || '').trim(),
        [AcademicLevel.DOCTORATE]: String(process.env.BOOTSTRAP_SIGAA_SOURCE_ID_DOUTORADO || '').trim(),
    };

    return levelMap[level] || globalSourceId || defaultSourceIds[level];
};

const buildSigaaLevelSources = (
    sourceId: string | undefined,
    academicLevel: AcademicLevel | 'all',
    sourceIdsByLevel?: Partial<Record<AcademicLevel, string>>
) => {
    const globalSourceId = String(sourceId || '').trim() || readSigaaSourceIdFromEnv();
    const scopedSourceIds: Partial<Record<AcademicLevel, string>> = {
        [AcademicLevel.GRADUATION]: String(sourceIdsByLevel?.graduacao || '').trim() || readSigaaSourceIdFromEnv(AcademicLevel.GRADUATION),
        [AcademicLevel.MASTERS]: String(sourceIdsByLevel?.mestrado || '').trim() || readSigaaSourceIdFromEnv(AcademicLevel.MASTERS),
        [AcademicLevel.DOCTORATE]: String(sourceIdsByLevel?.doutorado || '').trim() || readSigaaSourceIdFromEnv(AcademicLevel.DOCTORATE),
    };

    if (academicLevel !== 'all') {
        const levelSourceId = globalSourceId || scopedSourceIds[academicLevel] || '';

        return {
            globalSourceId,
            scopedSourceIds,
            levelSources: levelSourceId
                ? [{ level: academicLevel, sourceId: levelSourceId }]
                : [],
        };
    }

    const levels: AcademicLevel[] = [AcademicLevel.GRADUATION, AcademicLevel.MASTERS, AcademicLevel.DOCTORATE];
    const levelSources = levels
        .map((level) => ({
            level,
            sourceId: String(scopedSourceIds[level] || globalSourceId || '').trim(),
        }))
        .filter((entry) => !!entry.sourceId);

    return {
        globalSourceId,
        scopedSourceIds,
        levelSources,
    };
};

class ComponentController {
    async importComponentsFromSiac(request: Request, response: Response) {
        const { cdCurso, nuPerCursoInicial } = request.body;
        const authenticatedUserId = request.headers
            .authenticatedUserId as string;
        const crawlerService = new CrawlerService();

        if (!cdCurso || !nuPerCursoInicial) {
            return response.status(400).json({
                message:
                    'O código do curso ou o semestre vigente não foram encontrados!',
            });
        }

        const importSummary = await crawlerService.importComponentsFromSiac(
            authenticatedUserId,
            cdCurso,
            nuPerCursoInicial
        );

        return response.status(201).json({
            ...importSummary,
            parameters: {
                cdCurso,
                nuPerCursoInicial,
            },
        });
    }

    async importComponentsFromSigaaPublic(request: Request, response: Response) {
        const { sourceType, sourceId, academicLevel, sourceIdsByLevel, maxComponents, enrichDetails } = request.body as {
            sourceType: 'department' | 'program';
            sourceId: string;
            academicLevel: AcademicLevel | 'all';
            sourceIdsByLevel?: Partial<Record<AcademicLevel, string>>;
            maxComponents?: number;
            enrichDetails?: boolean;
        };
        const authenticatedUserId = request.headers.authenticatedUserId as string;
        const crawlerService = new CrawlerService();
        const importOptions = {
            maxComponents: Number.isFinite(maxComponents) ? Math.max(1, Number(maxComponents)) : undefined,
            enrichDetails: enrichDetails === undefined ? true : Boolean(enrichDetails),
            reconcileExisting: true,
        };
        const { globalSourceId, scopedSourceIds, levelSources } = buildSigaaLevelSources(sourceId, academicLevel, sourceIdsByLevel);

        if (!sourceType || !academicLevel) {
            return response.status(400).json({
                message: 'sourceType e academicLevel são obrigatórios.',
            });
        }

        if (academicLevel !== 'all' && levelSources.length === 0) {
            return response.status(400).json({
                message: 'sourceId ausente. Informe no payload ou configure BOOTSTRAP_SIGAA_SOURCE_ID(_POR_NIVEL) no ambiente de produção.',
            });
        }

        if (academicLevel === 'all') {
            if (levelSources.length === 0) {
                return response.status(400).json({
                    message: 'Sem IDs SIGAA válidos. Informe sourceId/sourceIdsByLevel ou configure BOOTSTRAP_SIGAA_SOURCE_ID(_POR_NIVEL) em produção.',
                });
            }
        }

        if (academicLevel !== 'all' && !Object.values(AcademicLevel).includes(academicLevel as AcademicLevel)) {
            return response.status(400).json({
                message: 'academicLevel deve ser graduacao, mestrado, doutorado ou all.',
            });
        }

        let importSummary;

        if (academicLevel === 'all') {
            const levels: AcademicLevel[] = [AcademicLevel.GRADUATION, AcademicLevel.MASTERS, AcademicLevel.DOCTORATE];
            const combined = {
                source: 'sigaa-public' as const,
                requested: 0,
                created: 0,
                skippedExisting: 0,
                reconciled: 0,
                failed: 0,
                failures: [] as string[],
                failureCategories: {} as Record<string, number>,
            };

            for (const level of levels) {
                const scopedSourceId = levelSources.find((entry) => entry.level === level)?.sourceId || '';

                if (!scopedSourceId) {
                    continue;
                }

                const partial = await crawlerService.importComponentsFromSigaaPublic(
                    authenticatedUserId,
                    sourceType,
                    scopedSourceId,
                    level,
                    importOptions
                );

                combined.requested += partial.requested;
                combined.created += partial.created;
                combined.skippedExisting += partial.skippedExisting;
                combined.reconciled += partial.reconciled || 0;
                combined.failed += partial.failed;
                combined.failures.push(...(partial.failures || []));

                Object.entries(partial.failureCategories || {}).forEach(([key, count]) => {
                    combined.failureCategories[key] = (combined.failureCategories[key] || 0) + count;
                });
            }

            combined.failures = Array.from(new Set(combined.failures));
            importSummary = combined;
        } else {
            importSummary = await crawlerService.importComponentsFromSigaaPublic(
                authenticatedUserId,
                sourceType,
                levelSources[0].sourceId,
                academicLevel,
                importOptions
            );
        }

        return response.status(201).json({
            ...importSummary,
            parameters: {
                sourceType,
                sourceId: globalSourceId,
                academicLevel,
                sourceIdsByLevel: scopedSourceIds,
                maxComponents: importOptions.maxComponents,
                enrichDetails: importOptions.enrichDetails,
            },
        });
    }

    async createSigaaPublicImportJob(request: Request, response: Response) {
        const { sourceType, sourceId, academicLevel, sourceIdsByLevel, batchSize, enrichDetails } = request.body as {
            sourceType: 'department' | 'program';
            sourceId?: string;
            academicLevel: AcademicLevel | 'all';
            sourceIdsByLevel?: Partial<Record<AcademicLevel, string>>;
            batchSize?: number;
            enrichDetails?: boolean;
        };
        const authenticatedUserId = request.headers.authenticatedUserId as string;

        if (!sourceType || !academicLevel) {
            return response.status(400).json({
                message: 'sourceType e academicLevel são obrigatórios.',
            });
        }

        if (academicLevel !== 'all' && !Object.values(AcademicLevel).includes(academicLevel as AcademicLevel)) {
            return response.status(400).json({
                message: 'academicLevel deve ser graduacao, mestrado, doutorado ou all.',
            });
        }

        const { levelSources, scopedSourceIds, globalSourceId } = buildSigaaLevelSources(sourceId, academicLevel, sourceIdsByLevel);

        if (!levelSources.length) {
            return response.status(400).json({
                message: 'Sem IDs SIGAA válidos para criar o job. Informe sourceId/sourceIdsByLevel ou configure BOOTSTRAP_SIGAA_SOURCE_ID(_POR_NIVEL).',
            });
        }

        const jobService = SigaaImportJobService.getInstance();
        const job = jobService.createJob({
            createdBy: authenticatedUserId,
            sourceType,
            levels: levelSources,
            batchSize: Number.isFinite(batchSize) ? Math.max(1, Number(batchSize)) : 50,
            enrichDetails: enrichDetails === undefined ? false : Boolean(enrichDetails),
            reconcileExisting: true,
        });

        return response.status(202).json({
            message: 'Job de importação SIGAA iniciado.',
            job,
            parameters: {
                sourceType,
                academicLevel,
                sourceId: globalSourceId,
                sourceIdsByLevel: scopedSourceIds,
                batchSize: Number.isFinite(batchSize) ? Math.max(1, Number(batchSize)) : 50,
                enrichDetails: enrichDetails === undefined ? false : Boolean(enrichDetails),
            },
        });
    }

    async listSigaaPublicImportJobs(_request: Request, response: Response) {
        const jobService = SigaaImportJobService.getInstance();
        const jobs = jobService.listJobs();

        return response.status(200).json({
            results: jobs,
            total: jobs.length,
        });
    }

    async getSigaaPublicImportJob(request: Request, response: Response) {
        const { jobId } = request.params;
        const jobService = SigaaImportJobService.getInstance();
        const job = jobService.getJob(jobId);

        if (!job) {
            return response.status(404).json({
                message: 'Job de importação não encontrado.',
            });
        }

        return response.status(200).json(job);
    }

    async cancelSigaaPublicImportJob(request: Request, response: Response) {
        const { jobId } = request.params;
        const jobService = SigaaImportJobService.getInstance();
        const job = jobService.cancelJob(jobId);

        return response.status(200).json({
            message: 'Cancelamento solicitado para o job.',
            job,
        });
    }

    async getComponents(request: Request, response: Response) {
        const componentService = new ComponentService();

        const search = String(request.query.search ?? request.query.filter ?? '').trim() || undefined;
        const sortBy = String(request.query.sortBy ?? '').trim() || undefined;
        const sortOrder = String(request.query.sortOrder ?? 'ASC').toUpperCase() === 'DESC'
            ? 'DESC'
            : 'ASC';
        const academicLevelQuery = String(request.query.academicLevel ?? '').trim();
        const academicLevel = Object.values(AcademicLevel).includes(academicLevelQuery as AcademicLevel)
            ? (academicLevelQuery as AcademicLevel)
            : undefined;
        const department = String(request.query.department ?? '').trim() || undefined;
        const page = parseInt(String(request.query.page)) || 0;
        const limit = parseInt(String(request.query.limit)) || 10;

        const isAuthenticated = isUserAuthenticated(
            request.headers.authorization
        );

        const components = await componentService.getComponents({
            search,
            showDraft: isAuthenticated,
            sortBy,
            sortOrder,
            academicLevel,
            department,
        });

        return response
            .status(200)
            .json(paginate(components, { page, limit, search, sortBy, sortOrder, filters: { academicLevel, department } }));
    }

    async getComponentByCode(request: Request, response: Response) {
        const componentService = new ComponentService();

        const component = await componentService.getComponentByCode(
            request.params.code
        );

        return response.status(200).json(component);
    }

    async getSharedPublicComponent(request: Request, response: Response) {
        const { token } = request.params;
        const publicShareService = new ComponentPublicShareService();
        const component = await publicShareService.getPublishedComponentByToken(token);

        return response.status(200).json(component);
    }

    async getComponentLogs(request: Request, response: Response) {
        const componentLogService = new ComponentLogService();

        const componentId = request.params.id;

        const page = parseInt(String(request.query.page)) || 0;
        const limit = parseInt(String(request.query.limit)) || 10;
        const type = request.query.type as string;
        const sortBy = String(request.query.sortBy ?? '').trim() || undefined;
        const sortOrder = String(request.query.sortOrder ?? 'DESC').toUpperCase() === 'ASC'
            ? 'ASC'
            : 'DESC';

        const componentLogs = await componentLogService.getComponentLogs(
            componentId,
            { type, sortBy, sortOrder }
        );

        return response
            .status(200)
            .json(paginate(componentLogs, { page, limit, sortBy, sortOrder, filters: { type } }));
    }

    async create(request: Request, response: Response) {
        const authenticatedUserId = request.headers
            .authenticatedUserId as string;
        const componentService = new ComponentService();

        const content = await componentService.create(
            authenticatedUserId,
            request.body
        );

        return response.status(201).json(content);
    }

    async update(request: Request, response: Response) {
        const authenticatedUserId = request.headers
            .authenticatedUserId as string;
        const { id } = request.params;

        const componentService = new ComponentService();
        const content = await componentService.update(
            id,
            request.body,
            authenticatedUserId
        );

        return response.status(200).json(content);
    }

    async delete(request: Request, response: Response) {
        const { id } = request.params;

        const componentService = new ComponentService();
        await componentService.delete(id);

        return response
            .status(200)
            .json({ message: 'Component has been deleted!' });
    }

    async export(request: Request, response: Response) {
        const { id } = request.params;
        const requestFormat = String(request.query.format ?? 'pdf').toLowerCase();
        const format = requestFormat === 'doc' || requestFormat === 'docx'
            ? requestFormat
            : 'pdf';
        const componentService = new ComponentService();
        const exportedFile = await componentService.export(id, format as 'pdf' | 'doc' | 'docx');
        response.set({
            'Content-Type': exportedFile.contentType,
            'Content-Disposition': `attachment; filename="${exportedFile.fileName}"`,
        });
        return response.status(200).send(exportedFile.buffer);
    }

    async createPublicShare(request: Request, response: Response) {
        const { id } = request.params;
        const authenticatedUserId = request.headers.authenticatedUserId as string;
        const { expiresInHours } = request.body as { expiresInHours?: number };

        const publicShareService = new ComponentPublicShareService();
        const publicShare = await publicShareService.createShare(
            id,
            authenticatedUserId,
            expiresInHours
        );

        return response.status(201).json({
            ...publicShare,
            publicLink: `/publico/disciplinas/${publicShare.token}`,
        });
    }

    async getActivePublicShares(request: Request, response: Response) {
        const { id } = request.params;
        const authenticatedUserId = request.headers.authenticatedUserId as string;
        const page = parseInt(String(request.query.page)) || 0;
        const limit = parseInt(String(request.query.limit)) || 10;
        const sortBy = String(request.query.sortBy ?? '').trim() || 'createdAt';
        const sortOrder = String(request.query.sortOrder ?? 'DESC').toUpperCase() === 'ASC'
            ? 'ASC'
            : 'DESC';
        const creatorId = String(request.query.creatorId ?? '').trim() || undefined;
        const expirationRange = String(request.query.expirationRange ?? 'all').trim() as '24h' | '72h' | '168h' | 'all';

        const publicShareService = new ComponentPublicShareService();
        const shares = await publicShareService.listActiveShares(id, authenticatedUserId, {
            page,
            limit,
            sortBy,
            sortOrder,
            creatorId,
            expirationRange,
        });

        const totalPages = limit > 0 ? Math.ceil(shares.total / limit) : 0;

        return response.status(200).json({
            results: shares.results.map((share) => ({
                ...share,
                publicLink: `/publico/disciplinas/${share.token}`,
            })),
            total: shares.total,
            meta: {
                page,
                limit,
                total: shares.total,
                totalPages,
                sortBy,
                sortOrder,
                filters: {
                    creatorId,
                    expirationRange,
                },
            },
        });
    }

    async revokePublicShare(request: Request, response: Response) {
        const { shareId } = request.params;
        const authenticatedUserId = request.headers.authenticatedUserId as string;

        const publicShareService = new ComponentPublicShareService();
        const revokedShare = await publicShareService.revokeShare(shareId, authenticatedUserId);

        return response.status(200).json(revokedShare);
    }

    async revokeAllPublicShares(request: Request, response: Response) {
        const { id } = request.params;
        const authenticatedUserId = request.headers.authenticatedUserId as string;

        const publicShareService = new ComponentPublicShareService();
        const result = await publicShareService.revokeAllActiveShares(id, authenticatedUserId);

        return response.status(200).json(result);
    }
}

export { ComponentController };
