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
        this.runJob(job.id).catch((error) => {
            const current = this.jobs.get(job.id);

            if (!current) {
                return;
            }

            current.status = 'failed';
            current.finishedAt = new Date().toISOString();
            current.lastError = error instanceof Error ? error.message : 'Falha desconhecida na execução do job.';
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

                const partial = await crawlerService.importComponentsFromSigaaPublic(
                    job.createdBy,
                    job.sourceType,
                    levelConfig.sourceId,
                    levelConfig.level,
                    {
                        reconcileExisting: job.reconcileExisting,
                        enrichDetails: job.enrichDetails,
                        maxComponents: job.batchSize,
                        offset: levelConfig.offset,
                    }
                );

                this.mergeSummary(job, partial);

                levelConfig.batches += 1;
                levelConfig.totalAvailable = partial.totalAvailable;
                job.progress.batchesProcessed += 1;

                const processedInBatch = partial.processed ?? partial.requested;

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
        } else {
            job.status = 'completed';
        }

        job.finishedAt = new Date().toISOString();
    }

    private cloneJob(job: SigaaImportJob): SigaaImportJob {
        return JSON.parse(JSON.stringify(job)) as SigaaImportJob;
    }
}

export { SigaaImportJobService };
