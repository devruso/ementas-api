import { v4 as uuidv4 } from 'uuid';

import { AcademicLevel } from '../interfaces/AcademicLevel';
import { AppError } from '../errors/AppError';
import { CrawlerService, ImportComponentsSummary } from './CrawlerService';

type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

type JobLevel = {
    level: AcademicLevel;
    sourceId: string;
    offset: number;
    batches: number;
    done: boolean;
    totalAvailable?: number;
};

type JobTotals = {
    requested: number;
    created: number;
    skippedExisting: number;
    reconciled: number;
    failed: number;
    failures: string[];
    failureCategories: Record<string, number>;
};

export type SigaaImportJob = {
    id: string;
    status: JobStatus;
    sourceType: 'department' | 'program';
    levels: JobLevel[];
    batchSize: number;
    enrichDetails: boolean;
    reconcileExisting: boolean;
    requestTimeoutMs: number;
    createdBy: string;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
    cancelRequested: boolean;
    progress: {
        currentLevel?: AcademicLevel;
        completedLevels: number;
        totalLevels: number;
        batchesProcessed: number;
    };
    totals: JobTotals;
    lastError?: string;
};

type CreateSigaaImportJobInput = {
    createdBy: string;
    sourceType: 'department' | 'program';
    levels: Array<{ level: AcademicLevel; sourceId: string }>;
    batchSize?: number;
    enrichDetails?: boolean;
    reconcileExisting?: boolean;
    requestTimeoutMs?: number;
};

class SigaaImportJobService {
    private static instance: SigaaImportJobService;

    private jobs = new Map<string, SigaaImportJob>();

    static getInstance() {
        if (!SigaaImportJobService.instance) {
            SigaaImportJobService.instance = new SigaaImportJobService();
        }

        return SigaaImportJobService.instance;
    }

    createJob(input: CreateSigaaImportJobInput) {
        if (!input.levels.length) {
            throw new AppError('Nenhum nível SIGAA informado para processamento.', 400);
        }

        const job: SigaaImportJob = {
            id: uuidv4(),
            status: 'pending',
            sourceType: input.sourceType,
            levels: input.levels.map((entry) => ({
                level: entry.level,
                sourceId: entry.sourceId,
                offset: 0,
                batches: 0,
                done: false,
            })),
            batchSize: Math.max(1, Number(input.batchSize || 50)),
            enrichDetails: input.enrichDetails ?? false,
            reconcileExisting: input.reconcileExisting ?? true,
            requestTimeoutMs: Number.isFinite(input.requestTimeoutMs) ? Math.max(1000, Number(input.requestTimeoutMs)) : 120000,
            createdBy: input.createdBy,
            createdAt: new Date().toISOString(),
            cancelRequested: false,
            progress: {
                completedLevels: 0,
                totalLevels: input.levels.length,
                batchesProcessed: 0,
            },
            totals: {
                requested: 0,
                created: 0,
                skippedExisting: 0,
                reconciled: 0,
                failed: 0,
                failures: [],
                failureCategories: {},
            },
        };

        this.jobs.set(job.id, job);
        console.log(`[sigaa-job:${job.id}] started sourceType=${job.sourceType} levels=${job.levels.map((l) => `${l.level}:${l.sourceId}`).join(',')} batchSize=${job.batchSize} timeoutMs=${job.requestTimeoutMs}`);
        this.runJob(job.id).catch((error) => {
            const current = this.jobs.get(job.id);

            if (!current) {
                return;
            }

            current.status = 'failed';
            current.finishedAt = new Date().toISOString();
            current.lastError = error instanceof Error ? error.message : 'Falha desconhecida na execução do job.';
            console.log(`[sigaa-job:${job.id}] failed ${current.lastError}`);
        });

        return this.cloneJob(job);
    }

    listJobs() {
        return Array.from(this.jobs.values())
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
            .map((job) => this.cloneJob(job));
    }

    getJob(jobId: string) {
        const job = this.jobs.get(jobId);

        if (!job) {
            return undefined;
        }

        return this.cloneJob(job);
    }

    cancelJob(jobId: string) {
        const job = this.jobs.get(jobId);

        if (!job) {
            throw new AppError('Job de importação não encontrado.', 404);
        }

        job.cancelRequested = true;

        if (job.status === 'pending') {
            job.status = 'cancelled';
            job.finishedAt = new Date().toISOString();
        }

        return this.cloneJob(job);
    }

    private isRetryableNetworkError(error: unknown) {
        const message = error instanceof Error ? error.message : String(error || '');
        return /ETIMEDOUT|ECONNRESET|ECONNABORTED|ENETUNREACH|EHOSTUNREACH|timeout/i.test(message);
    }

    private classifyJobError(error: unknown) {
        const message = error instanceof Error ? error.message : String(error || '');

        if (/ETIMEDOUT|ECONNABORTED|timeout/i.test(message)) {
            return 'source_timeout';
        }

        if (/ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(message)) {
            return 'source_connection_error';
        }

        return 'unexpected_error';
    }

    private async runImportBatchWithRetry(
        crawlerService: CrawlerService,
        job: SigaaImportJob,
        levelConfig: JobLevel
    ) {
        const maxAttempts = 3;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                return await crawlerService.importComponentsFromSigaaPublic(
                    job.createdBy,
                    job.sourceType,
                    levelConfig.sourceId,
                    levelConfig.level,
                    {
                        reconcileExisting: job.reconcileExisting,
                        enrichDetails: job.enrichDetails,
                        maxComponents: job.batchSize,
                        offset: levelConfig.offset,
                        requestTimeoutMs: job.requestTimeoutMs,
                    }
                );
            } catch (error) {
                if (!this.isRetryableNetworkError(error) || attempt >= maxAttempts) {
                    throw error;
                }

                const retryDelayMs = attempt * 2000;
                console.log(`[sigaa-job:${job.id}] retry level=${levelConfig.level} attempt=${attempt + 1}/${maxAttempts} after ${retryDelayMs}ms`);
                await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            }
        }

        throw new Error('Falha inesperada ao executar lote do job SIGAA.');
    }

    private mergeSummary(job: SigaaImportJob, partial: ImportComponentsSummary) {
        job.totals.requested += partial.requested;
        job.totals.created += partial.created;
        job.totals.skippedExisting += partial.skippedExisting;
        job.totals.reconciled += partial.reconciled || 0;
        job.totals.failed += partial.failed;

        if (partial.failures?.length) {
            job.totals.failures.push(...partial.failures);
            job.totals.failures = Array.from(new Set(job.totals.failures));
        }

        Object.entries(partial.failureCategories || {}).forEach(([category, count]) => {
            job.totals.failureCategories[category] = (job.totals.failureCategories[category] || 0) + count;
        });
    }

    private async runJob(jobId: string) {
        const job = this.jobs.get(jobId);

        if (!job) {
            return;
        }

        if (job.status === 'cancelled') {
            return;
        }

        job.status = 'running';
        job.startedAt = new Date().toISOString();
        const crawlerService = new CrawlerService();

        for (const levelConfig of job.levels) {
            if (job.cancelRequested) {
                job.status = 'cancelled';
                job.finishedAt = new Date().toISOString();
                return;
            }

            job.progress.currentLevel = levelConfig.level;

            while (!levelConfig.done) {
                if (job.cancelRequested) {
                    job.status = 'cancelled';
                    job.finishedAt = new Date().toISOString();
                    return;
                }

                let partial: ImportComponentsSummary;

                try {
                    partial = await this.runImportBatchWithRetry(crawlerService, job, levelConfig);
                } catch (error) {
                    const category = this.classifyJobError(error);
                    const message = error instanceof Error ? error.message : 'Falha desconhecida no lote SIGAA.';

                    job.totals.failed += 1;
                    job.totals.failureCategories[category] = (job.totals.failureCategories[category] || 0) + 1;
                    job.totals.failures.push(`SIGAA_JOB_LEVEL:${levelConfig.level}:${levelConfig.sourceId} (${category})`);
                    job.totals.failures = Array.from(new Set(job.totals.failures));

                    console.log(`[sigaa-job:${job.id}] level=${levelConfig.level} failed ${message}`);
                    levelConfig.done = true;
                    break;
                }

                this.mergeSummary(job, partial);

                levelConfig.batches += 1;
                levelConfig.totalAvailable = partial.totalAvailable;
                job.progress.batchesProcessed += 1;

                const processedInBatch = partial.processed ?? partial.requested;
                console.log(`[sigaa-job:${job.id}] level=${levelConfig.level} batch=${levelConfig.batches} requested=${partial.requested} created=${partial.created} skipped=${partial.skippedExisting} failed=${partial.failed} offset=${levelConfig.offset} nextOffset=${partial.nextOffset ?? 'end'}`);

                if (processedInBatch <= 0) {
                    levelConfig.done = true;
                    break;
                }

                if (partial.hasMore) {
                    levelConfig.offset = partial.nextOffset ?? (levelConfig.offset + processedInBatch);
                    continue;
                }

                levelConfig.done = true;
            }

            job.progress.completedLevels += 1;
        }

        if (job.cancelRequested) {
            job.status = 'cancelled';
            console.log(`[sigaa-job:${job.id}] cancelled`);
        } else if (job.totals.failed > 0 && job.totals.created === 0 && job.totals.skippedExisting === 0) {
            job.status = 'failed';
            job.lastError = 'Falha de conectividade com SIGAA em todos os níveis processados.';
            console.log(`[sigaa-job:${job.id}] failed no successful batches`);
        } else {
            job.status = 'completed';
            console.log(`[sigaa-job:${job.id}] completed requested=${job.totals.requested} created=${job.totals.created} skipped=${job.totals.skippedExisting} failed=${job.totals.failed}`);
        }

        job.finishedAt = new Date().toISOString();
    }

    private cloneJob(job: SigaaImportJob): SigaaImportJob {
        return JSON.parse(JSON.stringify(job)) as SigaaImportJob;
    }
}

export { SigaaImportJobService };
