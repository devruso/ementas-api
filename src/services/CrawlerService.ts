/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import path from 'path';
import { getCustomRepository, Repository } from 'typeorm';
import axios, { AxiosRequestConfig } from 'axios';
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';

import { Component } from '../entities/Component';
import { ComponentRepository } from '../repositories/ComponentRepository';
import { AppError } from '../errors/AppError';
import { WorkloadService } from './WorkloadService';
import { ComponentLog } from '../entities/ComponentLog';
import { ComponentLogRepository } from '../repositories/ComponentLogRepository';
import { ComponentStatus } from '../interfaces/ComponentStatus';
import { ComponentLogType } from '../interfaces/ComponentLogType';
import { AcademicLevel } from '../interfaces/AcademicLevel';
import { IComponentInfoCrawler } from '../interfaces/IComponentInfoCrawler';
import { ComponentDraft } from '../entities/ComponentDraft';
import { ComponentDraftRepository } from '../repositories/ComponentDraftRepository';
import { ComponentRelation } from '../entities/ComponentRelation';
import { ComponentRelationRepository } from '../repositories/ComponentRelationRepository';
import { ComponentRelationType } from '../interfaces/ComponentRelationType';
import { getTextCorruptionScore, repairLikelyUtf8Mojibake } from '../helpers/repairMojibake';

export interface ImportComponentsSummary {
    source: 'siac' | 'sigaa-public';
    requested: number;
    created: number;
    skippedExisting: number;
    reconciled?: number;
    failed: number;
    failures: string[];
    failureCategories: Record<string, number>;
    totalAvailable?: number;
    processed?: number;
    hasMore?: boolean;
    nextOffset?: number;
}

type SigaaComponentDetail = {
    prerequeriments?: string;
    coRequisites?: string[];
    equivalences?: string[];
    syllabus?: string;
    objective?: string;
    methodology?: string;
    learningAssessment?: string;
    workload?: {
        theoretical: number;
        practice: number;
        internship: number;
        extension?: number;
    };
};

type SigaaJsfFormContext = {
    formId: string;
    actionUrl: string;
    hiddenInputs: Record<string, string>;
};

type SigaaDetailRawFields = {
    prerequeriments?: string;
    coReqRaw?: string;
    equivalencesRaw?: string;
    syllabus?: string;
    objective?: string;
    methodology?: string;
    learningAssessment?: string;
};

type SigaaDetailActionRequest = {
    detailActionUrl: string;
    detailActionPayload: string;
    priority: number;
};

const SIGAA_LABEL_MATCHERS = {
    prerequeriments: /^(pre\s*requisit(?:o|os)|prerequisit(?:o|os))$/i,
    coReqRaw: /^(co\s*requisit(?:o|os)|correquisit(?:o|os))$/i,
    equivalencesRaw: /^(equivalenc(?:ia|ias)|equivalente(?:\(s\))?)$/i,
    syllabus: /^ementa$/i,
    objective: /^objetiv(?:o|os)$/i,
    methodology: /^metodologia$/i,
    learningAssessment: /^(avaliac(?:ao|ao\s+da\s+aprendizagem)|avaliacao\s+da\s+aprendizagem)$/i,
};

export class CrawlerService {

    private componentRepository : Repository<Component>;
    private componentDraftRepository : Repository<ComponentDraft>;
    private componentLogRepository: Repository<ComponentLog>;
    private componentRelationRepository: Repository<ComponentRelation>;
    private workloadService: WorkloadService;
    private sigaaDetailCache = new Map<string, SigaaComponentDetail | null>();
    private sigaaDetailInFlight = new Map<string, Promise<SigaaComponentDetail | null>>();
    private requestTimeoutMs: number;

    constructor() {
        this.componentRepository = getCustomRepository(ComponentRepository);
        this.componentDraftRepository = getCustomRepository(ComponentDraftRepository);
        this.componentLogRepository = getCustomRepository(ComponentLogRepository);
        this.componentRelationRepository = getCustomRepository(ComponentRelationRepository);
        this.workloadService = new WorkloadService();
        this.requestTimeoutMs = Number(process.env.CRAWLER_HTTP_TIMEOUT_MS || 45000);
    }

    private normalizePrerequeriments(rawValue?: string) {
        const text = rawValue?.trim();

        if (!text) {
            return 'NAO_SE_APLICA';
        }

        const codeMatches = Array.from(new Set(text.toUpperCase().match(/\b[A-Z]{2,4}[0-9]{2,4}\b/g) ?? []));

        if (codeMatches.length) {
            return codeMatches.join(', ');
        }

        if (/^(n[aã]o\s+se\s+aplica|n[aã]o\s+h[aá]|nenhum(a)?|n\/a|[-–—]+|\(?\s*[-–—]+\s*\)?)$/i.test(text)) {
            return 'NAO_SE_APLICA';
        }

        if (/^(co\s*-?\s*requisit(?:o|os)|correquisit(?:o|os)|equivalenc(?:ia|ias)|equivalente(?:\(s\))?|ementa|objetiv(?:o|os)|metodologia|avaliac(?:ao|ao\s+da\s+aprendizagem))\s*:?$/i.test(text)) {
            return 'NAO_SE_APLICA';
        }

        return text;
    }

    private isNotApplicablePrerequeriment(value?: string) {
        const normalized = String(value || '').trim();

        if (!normalized) {
            return true;
        }

        return /^(NAO_SE_APLICA|n[aã]o\s+se\s+aplica|n\/a|[-–—]+|\(?\s*[-–—]+\s*\)?)$/i.test(normalized);
    }

    private hasMeaningfulText(value?: string) {
        const normalized = String(value || '').trim();

        if (!normalized) {
            return false;
        }

        return !/^(n[aã]o\s+h[aá]|n[aã]o\s+informado|n[aã]o\s+dispon[ií]vel|n\/a)$/i.test(normalized);
    }

    private scoreComponentCandidate(component: IComponentInfoCrawler) {
        let score = 0;

        if (!this.isNotApplicablePrerequeriment(component.prerequeriments)) {
            score += 8;
        }

        if ((component.coRequisites || []).length > 0) {
            score += 3;
        }

        if ((component.equivalences || []).length > 0) {
            score += 3;
        }

        if (this.hasMeaningfulText(component.syllabus)) {
            score += 2;
        }

        if (this.hasMeaningfulText(component.objective)) {
            score += 2;
        }

        if (this.hasMeaningfulText(component.methodology)) {
            score += 1;
        }

        if (this.hasMeaningfulText(component.learningAssessment)) {
            score += 1;
        }

        if (component.detailActionPayload || component.detailUrl) {
            score += 1;
        }

        return score;
    }

    private chooseBestComponentCandidate(
        current: IComponentInfoCrawler,
        candidate: IComponentInfoCrawler
    ) {
        const currentScore = this.scoreComponentCandidate(current);
        const candidateScore = this.scoreComponentCandidate(candidate);

        if (candidateScore > currentScore) {
            return candidate;
        }

        if (candidateScore < currentScore) {
            return current;
        }

        const currentSyllabusLength = String(current.syllabus || '').trim().length;
        const candidateSyllabusLength = String(candidate.syllabus || '').trim().length;

        if (candidateSyllabusLength > currentSyllabusLength) {
            return candidate;
        }

        return current;
    }

    private selectCanonicalComponentsByCode(components: Array<IComponentInfoCrawler>) {
        const canonicalByCode = new Map<string, IComponentInfoCrawler>();

        for (const component of components) {
            const current = canonicalByCode.get(component.code);

            if (!current) {
                canonicalByCode.set(component.code, component);
                continue;
            }

            canonicalByCode.set(
                component.code,
                this.chooseBestComponentCandidate(current, component)
            );
        }

        return Array.from(canonicalByCode.values());
    }

    private shouldAdoptIncomingField(currentValue?: string, incomingValue?: string) {
        const current = String(currentValue || '').trim();
        const incoming = String(incomingValue || '').trim();

        if (!incoming) {
            return false;
        }

        if (!current) {
            return true;
        }

        return incoming.length > current.length;
    }

    private async reconcileExistingComponentFromCrawlerData(data: IComponentInfoCrawler) {
        const existingComponent = await this.componentRepository.findOne({
            where: { code: data.code },
            relations: ['draft'],
        });

        if (!existingComponent) {
            return false;
        }

        let changed = false;
        const normalizedIncomingPrereq = this.normalizePrerequeriments(data.prerequeriments);
        const currentPrereq = this.normalizePrerequeriments(existingComponent.prerequeriments);

        if (String(existingComponent.prerequeriments || '').trim() !== currentPrereq) {
            existingComponent.prerequeriments = currentPrereq;
            if (existingComponent.draft) {
                existingComponent.draft.prerequeriments = currentPrereq;
            }
            changed = true;
        }

        const incomingHasPrereq = !this.isNotApplicablePrerequeriment(normalizedIncomingPrereq);
        const currentHasPrereq = !this.isNotApplicablePrerequeriment(currentPrereq);

        if (incomingHasPrereq && !currentHasPrereq) {
            existingComponent.prerequeriments = normalizedIncomingPrereq;
            if (existingComponent.draft) {
                existingComponent.draft.prerequeriments = normalizedIncomingPrereq;
            }
            changed = true;
        }

        const textFields: Array<
            'syllabus' | 'objective' | 'methodology' | 'learningAssessment'
        > = ['syllabus', 'objective', 'methodology', 'learningAssessment'];

        for (const field of textFields) {
            const incomingValue = String((data as any)[field] || '').trim();
            const currentValue = String((existingComponent as any)[field] || '').trim();

            if (!this.shouldAdoptIncomingField(currentValue, incomingValue)) {
                continue;
            }

            (existingComponent as any)[field] = incomingValue;
            if (existingComponent.draft) {
                (existingComponent.draft as any)[field] = incomingValue;
            }
            changed = true;
        }

        const existingRelations = await this.componentRelationRepository.find({
            where: { componentId: existingComponent.id },
        });

        const existingRelationKeys = new Set(
            (existingRelations || []).map(
                (relation) => `${relation.relationType}:${relation.relatedCode}`
            )
        );

        const newRelations = [
            ...(this.normalizeRelationCodes(data.coRequisites).map((relatedCode) => ({
                relationType: ComponentRelationType.CO_REQUISITE,
                relatedCode,
            }))),
            ...(this.normalizeRelationCodes(data.equivalences).map((relatedCode) => ({
                relationType: ComponentRelationType.EQUIVALENCE,
                relatedCode,
            }))),
        ].filter((relation) => relation.relatedCode !== existingComponent.code)
            .filter((relation) => !existingRelationKeys.has(`${relation.relationType}:${relation.relatedCode}`))
            .map((relation) => this.componentRelationRepository.create({
                componentId: existingComponent.id,
                relationType: relation.relationType,
                relatedCode: relation.relatedCode,
            }));

        if (newRelations.length > 0) {
            await this.componentRelationRepository.save(newRelations);
            changed = true;
        }

        if (!changed) {
            return false;
        }

        await this.componentRepository.save(existingComponent);

        if (existingComponent.draft) {
            await this.componentDraftRepository.save(existingComponent.draft);
        }

        return true;
    }

    private sanitizeTextField(rawValue: unknown, fallback = ''): string {
        const value = repairLikelyUtf8Mojibake(String(rawValue ?? ''))
            .replace(/\s+/g, ' ')
            .trim();

        return value || fallback;
    }

    private decodeHtmlBuffer(rawValue: ArrayBuffer | Buffer): string {
        const buffer = Buffer.isBuffer(rawValue) ? rawValue : Buffer.from(rawValue);
        const utf8Decoded = repairLikelyUtf8Mojibake(buffer.toString('utf8'));

        if (getTextCorruptionScore(utf8Decoded) === 0) {
            return utf8Decoded;
        }

        const latin1Decoded = repairLikelyUtf8Mojibake(buffer.toString('latin1'));

        return getTextCorruptionScore(latin1Decoded) <= getTextCorruptionScore(utf8Decoded)
            ? latin1Decoded
            : utf8Decoded;
    }

    private normalizeParagraphText(rawValue: unknown, fallback = ''): string {
        const normalized = String(rawValue ?? '')
            .split(/\r?\n/)
            .map((line) => this.sanitizeTextField(line))
            .filter(Boolean)
            .map((line) => line.replace(/^((\d+[.)-]?)|([A-Za-z][.)])|[-*•])\s+/u, ''))
            .join(' ')
            .replace(/\s{2,}/g, ' ')
            .trim();

        return normalized || fallback;
    }

    private sanitizeWorkloadValue(rawValue: unknown): number {
        const normalized = Number(rawValue);

        if (!Number.isFinite(normalized) || normalized < 0) {
            return 0;
        }

        return Math.floor(normalized);
    }

    private normalizeRelationCodes(rawList?: string[]): string[] {
        const normalized = (rawList || [])
            .map((value) => String(value || '').trim().toUpperCase())
            .filter(Boolean)
            .filter((value) => /\b[A-Z]{2,6}[0-9]{2,4}\b/.test(value));

        return Array.from(new Set(normalized));
    }

    private sanitizeImportedComponentData(data: IComponentInfoCrawler): IComponentInfoCrawler {
        const code = this.sanitizeTextField(data.code).toUpperCase();

        if (!code || !/^[A-Z]{2,6}[0-9]{2,4}$/.test(code)) {
            throw new AppError('Invalid component code from source.', 400);
        }

        const name = this.sanitizeTextField(data.name);

        if (!name) {
            throw new AppError('Invalid component name from source.', 400);
        }

        const workload = {
            theoretical: this.sanitizeWorkloadValue(data.workload?.theoretical),
            practice: this.sanitizeWorkloadValue(data.workload?.practice),
            internship: this.sanitizeWorkloadValue(data.workload?.internship),
        };

        const normalizeImportedNarrativeField = (rawValue: unknown) => {
            const normalized = this.normalizeParagraphText(rawValue).replace(/\s+/g, ' ').trim();

            if (!normalized) {
                return '';
            }

            if (/^\/?descri[cç][aã]o\s*:\s*n[aã]o\s+definido/i.test(normalized)) {
                return '';
            }

            if (/^ementa\s+n[aã]o\s+dispon[ií]vel\s+na\s+listagem\s+p[úu]blica\s+do\s+sigaa\.?$/i.test(normalized)) {
                return '';
            }

            if (/^conte[úu]do\s+program[aá]tico\s+n[aã]o\s+dispon[ií]vel\s+na\s+listagem\s+p[úu]blica\s+do\s+sigaa\.?$/i.test(normalized)) {
                return '';
            }

            if (/^institucional\s*:/i.test(normalized) && /quantidade\s+de\s+avalia[cç][õo]es/i.test(normalized)) {
                return '';
            }

            return normalized;
        };

        const description = normalizeImportedNarrativeField(data.description)
            || 'Conteúdo programático não informado pela fonte.';
        const syllabus = normalizeImportedNarrativeField(data.syllabus);
        const objective = normalizeImportedNarrativeField(data.objective);
        const methodology = normalizeImportedNarrativeField(data.methodology)
            || 'Não há Metodologia cadastrada';
        const learningAssessment = normalizeImportedNarrativeField(data.learningAssessment)
            || 'Não há Avaliação de Aprendizagem cadastrada';
        const bibliography = normalizeImportedNarrativeField(data.bibliography);

        return {
            ...data,
            code,
            name,
            department: this.sanitizeTextField(data.department, 'Departamento SIGAA'),
            semester: this.sanitizeTextField(data.semester),
            description,
            objective,
            syllabus,
            bibliography,
            prerequeriments: this.normalizePrerequeriments(data.prerequeriments),
            methodology,
            modality: this.sanitizeTextField(data.modality, 'DISCIPLINA'),
            learningAssessment,
            academicLevel: data.academicLevel ?? AcademicLevel.GRADUATION,
            coRequisites: this.normalizeRelationCodes(data.coRequisites),
            equivalences: this.normalizeRelationCodes(data.equivalences),
            workload,
        };
    }

    private classifyImportFailure(error: unknown): string {
        const genericCode = (error as { code?: string })?.code;
        const genericMessage = (error as { message?: string })?.message || '';

        if (genericCode === 'ECONNABORTED' || /timeout/i.test(genericMessage)) {
            return 'source_timeout';
        }

        if (axios.isAxiosError(error)) {
            const statusCode = error.response?.status;

            if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '')) {
                return 'source_timeout';
            }

            if (statusCode === 429) {
                return 'source_rate_limited';
            }

            if (statusCode != null && statusCode >= 500) {
                return 'source_unavailable';
            }

            return 'network_error';
        }

        if (error instanceof AppError) {
            if (error.message === 'Invalid component code from source.') {
                return 'invalid_code';
            }

            if (error.message === 'Invalid component name from source.') {
                return 'invalid_name';
            }

            if (error.message === 'No components found in SIGAA public source.') {
                return 'source_unavailable';
            }

            return 'validation_or_business_rule';
        }

        return 'unexpected_error';
    }

    private incrementFailureCategory(
        categories: Record<string, number>,
        category: string
    ) {
        categories[category] = (categories[category] || 0) + 1;
    }

    private getSigaaRetryAttempts() {
        const configured = Number(process.env.CRAWLER_SIGAA_RETRY_ATTEMPTS || 2);

        if (!Number.isFinite(configured)) {
            return 2;
        }

        return Math.max(1, Math.floor(configured));
    }

    private getSigaaRetryBackoffMs() {
        const configured = Number(process.env.CRAWLER_SIGAA_RETRY_BACKOFF_MS || 1500);

        if (!Number.isFinite(configured)) {
            return 1500;
        }

        return Math.max(100, Math.floor(configured));
    }

    private isRetryableSigaaError(error: unknown) {
        const genericCode = String((error as { code?: string })?.code || '').toUpperCase();
        const genericMessage = String((error as { message?: string })?.message || '');

        if (
            genericCode === 'ECONNABORTED'
            || genericCode === 'ETIMEDOUT'
            || genericCode === 'ECONNRESET'
            || genericCode === 'EHOSTUNREACH'
            || genericCode === 'ENETUNREACH'
            || /timeout/i.test(genericMessage)
        ) {
            return true;
        }

        if (axios.isAxiosError(error)) {
            const statusCode = Number(error.response?.status || 0);

            if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '')) {
                return true;
            }

            if (statusCode === 408 || statusCode === 429 || statusCode >= 500) {
                return true;
            }
        }

        return false;
    }

    private async executeSigaaRequestWithRetry<T>(
        operationLabel: string,
        requestFactory: () => Promise<T>
    ): Promise<T> {
        const maxAttempts = this.getSigaaRetryAttempts();
        const backoffMs = this.getSigaaRetryBackoffMs();

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                return await requestFactory();
            } catch (error) {
                if (!this.isRetryableSigaaError(error) || attempt >= maxAttempts) {
                    throw error;
                }

                const delayMs = backoffMs * attempt;
                console.log(`[sigaa-retry] ${operationLabel} attempt=${attempt + 1}/${maxAttempts} after ${delayMs}ms`);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }

        throw new Error('Falha inesperada em retry de requisição SIGAA.');
    }

    private extractPrerequerimentsFromLesson($lesson: cheerio.Cheerio<any>) {
        const text = $lesson.text().replace(/\s+/g, ' ').trim();
        const directMatch = text.match(/pré-?requisitos?\s*:?\s*([^|;]+)/i);

        if (directMatch?.[1]) {
            return this.normalizePrerequeriments(directMatch[1]);
        }

        return 'NAO_SE_APLICA';
    }

    private normalizeDepartmentLabel(rawDepartment: string, sourceType: 'department' | 'program') {
        const normalized = rawDepartment.replace(/\s+/g, ' ').trim();

        if (normalized) {
            return normalized;
        }

        return sourceType === 'department' ? 'Departamento SIGAA' : 'Programa SIGAA';
    }

    private getSigaaSourceUrls(
        sourceType: 'department' | 'program',
        sourceId: string,
        academicLevel: AcademicLevel
    ): string[] {
        const encodedId = encodeURIComponent(sourceId);
        const nivel = academicLevel === AcademicLevel.GRADUATION
            ? 'G'
            : academicLevel === AcademicLevel.MASTERS
                ? 'E'
                : 'D';

        if (sourceType === 'department') {
            return [
                `https://sigaa.ufba.br/sigaa/public/departamento/componentes.jsf?id=${encodedId}`,
                `https://sigaa.ufba.br/sigaa/public/departamento/portal.jsf?id=${encodedId}&lc=pt_BR`,
                `https://sigaa.ufba.br/sigaa/public/curso/curriculo.jsf?id=${encodedId}&lc=pt_BR&nivel=${nivel}`,
            ];
        }

        return [
            `https://sigaa.ufba.br/sigaa/public/programa/curriculo.jsf?lc=pt_BR&id=${encodedId}`,
            `https://sigaa.ufba.br/sigaa/public/curso/curriculo.jsf?id=${encodedId}&lc=pt_BR&nivel=${nivel}`,
            `https://sigaa.ufba.br/sigaa/public/departamento/componentes.jsf?id=${encodedId}`,
        ];
    }

    private getSigaaSearchLevel(academicLevel: AcademicLevel): 'G' | 'S' {
        return academicLevel === AcademicLevel.GRADUATION ? 'G' : 'S';
    }

    private buildCookieHeader(setCookie?: string[] | string): string {
        if (!setCookie) {
            return '';
        }

        const values = Array.isArray(setCookie) ? setCookie : [setCookie];

        return values
            .map((entry) => String(entry || '').split(';')[0].trim())
            .filter(Boolean)
            .join('; ');
    }

    private mergeCookieHeaders(...cookies: Array<string | undefined>): string {
        const tokenMap = new Map<string, string>();

        cookies
            .filter(Boolean)
            .forEach((header) => {
                String(header || '')
                    .split(';')
                    .map((token) => token.trim())
                    .filter(Boolean)
                    .forEach((token) => {
                        const [key] = token.split('=');

                        if (!key) {
                            return;
                        }

                        tokenMap.set(key.trim(), token);
                    });
            });

        return Array.from(tokenMap.values()).join('; ');
    }

    private async searchSigaaComponentsByUnit(
        sourceType: 'department' | 'program',
        sourceId: string,
        academicLevel: AcademicLevel
    ): Promise<Array<IComponentInfoCrawler>> {
        const nivel = this.getSigaaSearchLevel(academicLevel);
        const formPageResponse = await this.executeSigaaRequestWithRetry(
            'sigaa-search-form',
            () => axios.get<ArrayBuffer>('https://sigaa.ufba.br/sigaa/public/componentes/busca_componentes.jsf', {
                responseType: 'arraybuffer',
                responseEncoding: 'binary',
                timeout: this.requestTimeoutMs,
            })
        );
        const formCookie = this.buildCookieHeader(formPageResponse.headers?.['set-cookie']);

        const formHtml = this.decodeHtmlBuffer(formPageResponse.data);
        const $formPage = cheerio.load(formHtml);

        const formId = $formPage('form').first().attr('id') || 'form';
        const action = $formPage('form').first().attr('action') || '/sigaa/public/componentes/busca_componentes.jsf';
        const viewState = $formPage('input[name="javax.faces.ViewState"]').first().attr('value') || '';
        const actionUrl = new URL(action, 'https://sigaa.ufba.br').toString();

        const payload = new URLSearchParams();
        payload.set(formId, formId);
        payload.set(`${formId}:nivel`, nivel);
        payload.set(`${formId}:checkTipo`, 'on');
        payload.set(`${formId}:tipo`, '2');
        payload.set(`${formId}:checkUnidade`, 'on');
        payload.set(`${formId}:unidades`, sourceId);
        payload.set(`${formId}:btnBuscarComponentes`, 'Buscar Componentes');

        if (viewState) {
            payload.set('javax.faces.ViewState', viewState);
        }

        const searchResponse = await this.executeSigaaRequestWithRetry(
            `sigaa-search-submit:${sourceType}:${sourceId}:${academicLevel}`,
            () => axios.post<ArrayBuffer>(actionUrl, payload.toString(), {
                responseType: 'arraybuffer',
                responseEncoding: 'binary',
                timeout: this.requestTimeoutMs,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    ...(formCookie ? { Cookie: formCookie } : {}),
                },
            })
        );
        const searchCookie = this.buildCookieHeader(searchResponse.headers?.['set-cookie']);
        const detailCookie = this.mergeCookieHeaders(formCookie, searchCookie);

        const searchHtml = this.decodeHtmlBuffer(searchResponse.data);
        const $searchPage = cheerio.load(searchHtml);

        return this.extractSigaaListRows($searchPage, sourceType, academicLevel, detailCookie);
    }

    private findCodeFromRowCells(cells: string[]): string | null {
        for (const cell of cells.slice(0, 2)) {
            const match = cell.match(/(^|[^A-Z0-9])([A-Z]{2,6}[0-9]{2,4})(?=[^A-Z0-9]|$)/);

            if (match?.[2]) {
                return match[2].toUpperCase();
            }
        }

        return null;
    }

    private extractSigaaWorkloadHours(rowCells: string[]): number {
        const hourMatch = rowCells
            .map((cell) => cell.match(/(\d{1,3})\s*h\b/i))
            .find((match) => !!match?.[1]);

        if (!hourMatch?.[1]) {
            return 0;
        }

        return Number(hourMatch[1]) || 0;
    }

    private extractSigaaComponentType(rowCells: string[]): string {
        const knownType = rowCells.find((cell) => /^(DISCIPLINA|ATIVIDADE|MODULO|M[ÓO]DULO)$/i.test(cell.trim()));

        if (knownType) {
            return knownType.trim();
        }

        return 'DISCIPLINA';
    }

    private normalizeSigaaDetailUrl(rawHref?: string): string | undefined {
        if (!rawHref) {
            return undefined;
        }

        if (/^javascript:/i.test(rawHref)) {
            return undefined;
        }

        if (rawHref.trim().startsWith('#')) {
            return undefined;
        }

        try {
            return new URL(rawHref, 'https://sigaa.ufba.br').toString();
        } catch {
            return undefined;
        }
    }

    private parseSigaaJsfOnclickInvocation(onclick: string): {
        formId: string;
        params: Record<string, string>;
    } | null {
        const callMatch = onclick.match(/jsfcljs\(document\.getElementById\('([^']+)'\),\{([^}]*)\}/);

        if (!callMatch?.[1] || !callMatch?.[2]) {
            return null;
        }

        const params: Record<string, string> = {};
        const pairRegex = /'([^']+)'\s*:\s*'([^']*)'/g;
        let pairMatch = pairRegex.exec(callMatch[2]);

        while (pairMatch) {
            params[pairMatch[1]] = pairMatch[2];
            pairMatch = pairRegex.exec(callMatch[2]);
        }

        return {
            formId: callMatch[1],
            params,
        };
    }

    private shouldCaptureSigaaDetailDebug(code: string): boolean {
        const enabled = String(process.env.CRAWLER_SIGAA_DEBUG_DETAIL || '').trim() === '1';
        const rawCodes = String(process.env.CRAWLER_SIGAA_DEBUG_CODES || '').trim();
        const codeList = rawCodes
            .split(',')
            .map((item) => item.trim().toUpperCase())
            .filter(Boolean);

        if (!enabled && codeList.length === 0) {
            return false;
        }

        if (codeList.length === 0) {
            return true;
        }

        return codeList.includes(String(code || '').trim().toUpperCase());
    }

    private captureSigaaDetailDebugSnapshot(
        component: IComponentInfoCrawler,
        request: { method: 'GET' | 'POST'; url: string; payload?: string; requestLabel: string },
        html: string,
        detail: SigaaComponentDetail | null
    ) {
        if (!this.shouldCaptureSigaaDetailDebug(component.code)) {
            return;
        }

        try {
            const debugDir = path.resolve(
                process.cwd(),
                String(process.env.CRAWLER_SIGAA_DEBUG_DIR || 'tmp/sigaa-detail-debug').trim()
            );
            fs.mkdirSync(debugDir, { recursive: true });

            const $ = cheerio.load(html);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const safeCode = String(component.code || 'UNKNOWN').replace(/[^A-Za-z0-9_-]/g, '_');
            const baseName = `${timestamp}__${safeCode}__${request.requestLabel}`;
            const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
            const labelSamples = $('th, td, strong, b')
                .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
                .toArray()
                .filter(Boolean)
                .slice(0, 40);

            const signature = {
                code: component.code,
                request,
                title: $('title').first().text().trim(),
                htmlLength: html.length,
                bodyTextLength: bodyText.length,
                hasPrereqLabel: /pr[eé]\s*-?\s*requisit(?:o|os|o\(s\))/i.test(bodyText),
                hasSyllabusLabel: /ementa/i.test(bodyText),
                hasObjectiveLabel: /objetiv(?:o|os)/i.test(bodyText),
                hasListForm: $('#formListagemComponentes').length > 0,
                forms: $('form')
                    .map((_, form) => ({
                        id: String($(form).attr('id') || ''),
                        action: String($(form).attr('action') || ''),
                    }))
                    .toArray(),
                extractedDetail: detail,
                labelSamples,
            };

            fs.writeFileSync(path.join(debugDir, `${baseName}.json`), JSON.stringify(signature, null, 2), 'utf8');
            fs.writeFileSync(path.join(debugDir, `${baseName}.html`), html, 'utf8');
        } catch {
            // Debug capture must never break import flow.
        }
    }

    private buildSigaaFormContexts($: CheerioAPI): Map<string, SigaaJsfFormContext> {
        const contexts = new Map<string, SigaaJsfFormContext>();

        $('form').each((_, form) => {
            const $form = $(form);
            const formId = $form.attr('id');

            if (!formId) {
                return;
            }

            const action = $form.attr('action') || '';
            const actionUrl = this.normalizeSigaaDetailUrl(action)
                || this.normalizeSigaaDetailUrl('/sigaa/public/componentes/busca_componentes.jsf')
                || 'https://sigaa.ufba.br/sigaa/public/componentes/busca_componentes.jsf';
            const hiddenInputs: Record<string, string> = {};

            hiddenInputs[formId] = formId;

            $form.find('input[name]').each((__, input) => {
                const name = $(input).attr('name');
                const value = $(input).attr('value') || '';

                if (name) {
                    hiddenInputs[name] = value;
                }
            });

            contexts.set(formId, {
                formId,
                actionUrl,
                hiddenInputs,
            });
        });

        return contexts;
    }

    private extractSigaaDetailActionFromRow(
        $: CheerioAPI,
        $row: cheerio.Cheerio<any>,
        formContexts: Map<string, SigaaJsfFormContext>
    ): {
        detailActionUrl?: string;
        detailActionPayload?: string;
        detailActionPayloadCandidates?: string[];
    } {
        const onclickValues = $row
            .find('a[onclick]')
            .map((_, anchor) => String($(anchor).attr('onclick') || ''))
            .toArray();
        const candidates: SigaaDetailActionRequest[] = [];

        onclickValues.forEach((onclick, index) => {
            const parsed = this.parseSigaaJsfOnclickInvocation(onclick);

            if (!parsed) {
                return;
            }

            const hasPotentialDetailParams =
                Object.prototype.hasOwnProperty.call(parsed.params, 'idComponente')
                || Object.prototype.hasOwnProperty.call(parsed.params, 'id')
                || Object.prototype.hasOwnProperty.call(parsed.params, 'publico');

            if (!hasPotentialDetailParams) {
                return;
            }

            const formContext = formContexts.get(parsed.formId);

            if (!formContext) {
                return;
            }

            const payload = new URLSearchParams();
            payload.set(parsed.formId, parsed.formId);
            payload.set(`${parsed.formId}_SUBMIT`, '1');

            Object.entries(formContext.hiddenInputs).forEach(([key, value]) => {
                payload.set(key, value);
            });
            Object.entries(parsed.params).forEach(([key, value]) => {
                payload.set(key, value);
            });

            let priority = 0;
            if (Object.prototype.hasOwnProperty.call(parsed.params, 'idComponente')) {
                priority += 100;
            }
            if (Object.prototype.hasOwnProperty.call(parsed.params, 'publico')) {
                priority += 40;
            }
            if (Object.prototype.hasOwnProperty.call(parsed.params, 'id')) {
                priority += 20;
            }
            priority += Math.max(0, 10 - index);

            candidates.push({
                detailActionUrl: formContext.actionUrl,
                detailActionPayload: payload.toString(),
                priority,
            });
        });

        const uniqueCandidates = Array.from(new Map(
            candidates
                .sort((left, right) => right.priority - left.priority)
                .map((candidate) => [`${candidate.detailActionUrl}|${candidate.detailActionPayload}`, candidate])
        ).values());

        if (uniqueCandidates.length === 0) {
            return {};
        }

        return {
            detailActionUrl: uniqueCandidates[0].detailActionUrl,
            detailActionPayload: uniqueCandidates[0].detailActionPayload,
            detailActionPayloadCandidates: uniqueCandidates.map((candidate) => candidate.detailActionPayload),
        };
    }

    private normalizeCodeList(rawValue?: string): string[] {
        const text = String(rawValue || '').trim();

        if (!text) {
            return [];
        }

        if (/(n[aã]o\s+h[aá]|nenhum(a)?|n\/a|n[aã]o\s+se\s+aplica)/i.test(text)) {
            return [];
        }

        const codes = Array.from(new Set(text.toUpperCase().match(/\b[A-Z]{2,6}[0-9]{2,4}\b/g) ?? []));

        if (codes.length) {
            return codes;
        }

        return [];
    }

    private extractFieldFromDetailText(text: string, labelVariants: string[], stopLabels: string[]): string {
        const escapedLabels = labelVariants.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const escapedStops = stopLabels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

        const regex = new RegExp(
            `\\b(?:${escapedLabels.join('|')})\\b\\s*(?::|-|–|—)?\\s*(.+?)(?=\\b(?:${escapedStops.join('|')})\\b(?:\\s*(?::|-|–|—))?|$)`,
            'i'
        );
        const match = text.match(regex);

        if (!match?.[1]) {
            return '';
        }

        return match[1].replace(/\s+/g, ' ').trim();
    }

    private normalizeSigaaLabel(rawLabel: string): string {
        return rawLabel
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[:\-–—]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    private assignSigaaDetailFieldByLabel(
        target: SigaaDetailRawFields,
        rawLabel: string,
        rawValue: string
    ) {
        const label = this.normalizeSigaaLabel(rawLabel);
        const value = String(rawValue || '').replace(/\s+/g, ' ').trim();

        if (!label || !value) {
            return;
        }

        if (!target.prerequeriments && SIGAA_LABEL_MATCHERS.prerequeriments.test(label)) {
            target.prerequeriments = value;
            return;
        }
        if (!target.coReqRaw && SIGAA_LABEL_MATCHERS.coReqRaw.test(label)) {
            target.coReqRaw = value;
            return;
        }
        if (!target.equivalencesRaw && SIGAA_LABEL_MATCHERS.equivalencesRaw.test(label)) {
            target.equivalencesRaw = value;
            return;
        }
        if (!target.syllabus && SIGAA_LABEL_MATCHERS.syllabus.test(label)) {
            target.syllabus = value;
            return;
        }
        if (!target.objective && SIGAA_LABEL_MATCHERS.objective.test(label)) {
            target.objective = value;
            return;
        }
        if (!target.methodology && SIGAA_LABEL_MATCHERS.methodology.test(label)) {
            target.methodology = value;
            return;
        }
        if (!target.learningAssessment && SIGAA_LABEL_MATCHERS.learningAssessment.test(label)) {
            target.learningAssessment = value;
        }
    }

    private extractSigaaStructuredDetailFields($: CheerioAPI): SigaaDetailRawFields {
        const fields: SigaaDetailRawFields = {};

        $('table tr').each((_, tr) => {
            const $cells = $(tr).find('th, td');
            if ($cells.length < 2) {
                return;
            }

            const label = $($cells[0]).text();
            const value = $($cells[1]).text();
            this.assignSigaaDetailFieldByLabel(fields, label, value);
        });

        $('dl').each((_, dl) => {
            const $dl = $(dl);
            const terms = $dl.find('dt').toArray();

            for (const term of terms) {
                const $term = $(term);
                const value = $term.next('dd').text();
                this.assignSigaaDetailFieldByLabel(fields, $term.text(), value);
            }
        });

        $('p, li, div').each((_, node) => {
            const text = $(node).text().replace(/\s+/g, ' ').trim();

            if (!text || text.length < 8) {
                return;
            }

            const pair = text.match(/^([^:–—-]{3,80})\s*(?::|-|–|—)\s*(.+)$/);

            if (!pair?.[1] || !pair?.[2]) {
                return;
            }

            this.assignSigaaDetailFieldByLabel(fields, pair[1], pair[2]);
        });

        $('b, strong, h3, h4').each((_, node) => {
            const $node = $(node);
            const label = $node.text().replace(/\s+/g, ' ').trim();

            if (!label || label.length > 90) {
                return;
            }

            const directContainer = $node.closest('td, div, p, li, section, article');
            const directText = directContainer.text().replace(/\s+/g, ' ').trim();
            const directValue = directText.replace(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*[:\-–—]?\s*`, 'i'), '').trim();
            const siblingValue = directContainer.next('td, div, p, li').text().replace(/\s+/g, ' ').trim();
            const value = directValue.length > siblingValue.length ? directValue : siblingValue;

            this.assignSigaaDetailFieldByLabel(fields, label, value);
        });

        return fields;
    }

    private hasUsefulSigaaDetail(detail?: SigaaComponentDetail | null): boolean {
        if (!detail) {
            return false;
        }

        const hasTextualContent = [
            detail.syllabus,
            detail.objective,
            detail.methodology,
            detail.learningAssessment,
        ].some((value) => this.hasMeaningfulText(value));
        const hasPrereq = !this.isNotApplicablePrerequeriment(detail.prerequeriments);
        const hasRelations = (detail.coRequisites?.length || 0) > 0 || (detail.equivalences?.length || 0) > 0;
        const hasWorkload =
            Number(detail.workload?.theoretical || 0) > 0
            || Number(detail.workload?.practice || 0) > 0
            || Number(detail.workload?.internship || 0) > 0
            || Number(detail.workload?.extension || 0) > 0;

        return hasTextualContent || hasPrereq || hasRelations || hasWorkload;
    }

    private parseSigaaComponentDetailPage($: CheerioAPI): SigaaComponentDetail {
        const pageText = $('body').text().replace(/\s+/g, ' ').trim();
        const structuredFields = this.extractSigaaStructuredDetailFields($);
        const stopLabels = [
            'Pré-Requisitos',
            'Pre-Requisitos',
            'Pré Requisitos',
            'Pre Requisitos',
            'Pré-Requisito',
            'Pre-Requisito',
            'Co-Requisitos',
            'Correquísitos',
            'Co Requisitos',
            'Correquisitos',
            'Co-Requisito',
            'Correquisito',
            'Equivalências',
            'Equivalencias',
            'Equivalente(s)',
            'Equivalente',
            'Ementa',
            'Objetivos',
            'Objetivo',
            'Metodologia',
            'Avaliação',
            'Avaliacao',
            'Avaliação da Aprendizagem',
            'Avaliacao da Aprendizagem',
            'Carga Horária',
            'Carga Horaria',
            'Bibliografia',
            'Teórica',
            'Teorica',
            'Prática',
            'Pratica',
            'Estágio',
            'Estagio',
            'Extensão',
            'Extensao',
        ];

        const prerequeriments = structuredFields.prerequeriments || this.extractFieldFromDetailText(
            pageText,
            [
                'Pré-Requisitos',
                'Pre-Requisitos',
                'Pré Requisitos',
                'Pre Requisitos',
                'Pré-Requisito',
                'Pre-Requisito',
                'Pré-requisito(s)',
                'Pre-requisito(s)',
            ],
            stopLabels
        );
        const coReqRaw = structuredFields.coReqRaw || this.extractFieldFromDetailText(
            pageText,
            ['Co-Requisitos', 'Correquísitos', 'Co Requisitos', 'Correquisitos', 'Co-Requisito', 'Correquisito'],
            stopLabels
        );
        const equivalencesRaw = structuredFields.equivalencesRaw || this.extractFieldFromDetailText(
            pageText,
            ['Equivalências', 'Equivalencias', 'Equivalente(s)', 'Equivalente'],
            stopLabels
        );
        const syllabus = structuredFields.syllabus || this.extractFieldFromDetailText(pageText, ['Ementa'], stopLabels);
        const objective = structuredFields.objective || this.extractFieldFromDetailText(pageText, ['Objetivos', 'Objetivo'], stopLabels);
        const methodology = structuredFields.methodology || this.extractFieldFromDetailText(pageText, ['Metodologia'], stopLabels);
        const learningAssessment = structuredFields.learningAssessment || this.extractFieldFromDetailText(
            pageText,
            ['Avaliação', 'Avaliacao', 'Avaliação da Aprendizagem', 'Avaliacao da Aprendizagem'],
            stopLabels
        );

        const extractHours = (patterns: RegExp[]) => {
            for (const pattern of patterns) {
                const match = pageText.match(pattern);

                if (match?.[1]) {
                    return Number(match[1]) || 0;
                }
            }

            return 0;
        };

        const theoretical = extractHours([/te[oó]rica\s*:?\s*(\d{1,3})(?:\s*h)?/i]);
        const practice = extractHours([/pr[aá]tica\s*:?\s*(\d{1,3})(?:\s*h)?/i]);
        const internship = extractHours([/est[aá]gio\s*:?\s*(\d{1,3})(?:\s*h)?/i]);
        const extension = extractHours([
            /extens[aã]o\s*:?\s*(\d{1,3})(?:\s*h)?/i,
            /carga\s*hor[aá]ria\s*de\s*extens[aã]o\s*:?\s*(\d{1,3})(?:\s*h)?/i,
        ]);

        return {
            prerequeriments: prerequeriments ? this.normalizePrerequeriments(prerequeriments) : undefined,
            coRequisites: this.normalizeCodeList(coReqRaw),
            equivalences: this.normalizeCodeList(equivalencesRaw),
            syllabus: syllabus || undefined,
            objective: objective || undefined,
            methodology: methodology || undefined,
            learningAssessment: learningAssessment || undefined,
            workload: {
                theoretical,
                practice,
                internship,
                extension,
            },
        };
    }

    private getDetailCacheKey(component: IComponentInfoCrawler): string {
        const componentIdentifier = this.extractSigaaComponentIdentifier(component);

        if (componentIdentifier) {
            return `id:${componentIdentifier}`;
        }

        if (component.detailUrl) {
            return `url:${component.detailUrl}`;
        }

        if (component.detailActionPayload) {
            const idComponente = component.detailActionPayload.match(/(?:^|&)idComponente=([^&]+)/i)?.[1];

            if (idComponente) {
                return `id:${idComponente}`;
            }

            return `payload:${component.detailActionPayload}`;
        }

        return `code:${component.code}`;
    }

    private extractSigaaComponentIdentifier(component: IComponentInfoCrawler): string | undefined {
        const payloadCandidates = [
            component.detailActionPayload,
            ...(component.detailActionPayloadCandidates || []),
        ].filter(Boolean) as string[];

        for (const payload of payloadCandidates) {
            const payloadId = payload.match(/(?:^|&)(?:idComponente|id)=([^&]+)/i)?.[1];

            if (payloadId) {
                return decodeURIComponent(payloadId);
            }
        }

        if (!component.detailUrl) {
            return undefined;
        }

        try {
            const detailUrl = new URL(component.detailUrl);
            const urlId = detailUrl.searchParams.get('idComponente')
                || detailUrl.searchParams.get('id')
                || detailUrl.searchParams.get('componente');

            return urlId ? decodeURIComponent(urlId) : undefined;
        } catch {
            return undefined;
        }
    }

    private getSigaaDetailRequestSequence(component: IComponentInfoCrawler): Array<{
        method: 'GET' | 'POST';
        url: string;
        payload?: string;
        requestLabel: string;
    }> {
        const requests: Array<{ method: 'GET' | 'POST'; url: string; payload?: string; requestLabel: string }> = [];

        if (component.detailUrl) {
            requests.push({
                method: 'GET',
                url: component.detailUrl,
                requestLabel: 'detail-url',
            });
        }

        const actionUrl = component.detailActionUrl;
        const payloadCandidates = [
            component.detailActionPayload,
            ...(component.detailActionPayloadCandidates || []),
        ].filter(Boolean) as string[];

        if (actionUrl && payloadCandidates.length > 0) {
            payloadCandidates.forEach((payload, index) => {
                requests.push({
                    method: 'POST',
                    url: actionUrl,
                    payload,
                    requestLabel: `detail-action-${index + 1}`,
                });
            });
        }

        return Array.from(new Map(
            requests.map((request) => [`${request.method}|${request.url}|${request.payload || ''}`, request])
        ).values());
    }

    private async getOrFetchSigaaComponentDetail(
        cacheKey: string,
        component: IComponentInfoCrawler,
        detailCache: Map<string, SigaaComponentDetail | null>,
        inFlightCache: Map<string, Promise<SigaaComponentDetail | null>>
    ): Promise<SigaaComponentDetail | null> {
        if (detailCache.has(cacheKey)) {
            return detailCache.get(cacheKey) || null;
        }

        const existingRequest = inFlightCache.get(cacheKey);

        if (existingRequest) {
            return existingRequest;
        }

        const request = this.fetchSigaaComponentDetail(component)
            .then((detail) => {
                detailCache.set(cacheKey, detail);
                return detail;
            })
            .finally(() => {
                inFlightCache.delete(cacheKey);
            });

        inFlightCache.set(cacheKey, request);

        return request;
    }

    private applySigaaDetailToComponent(
        component: IComponentInfoCrawler,
        detail: SigaaComponentDetail
    ) {
        if (detail.prerequeriments) {
            component.prerequeriments = detail.prerequeriments;
        }
        if (detail.syllabus) {
            component.syllabus = detail.syllabus;
        }
        if (detail.objective) {
            component.objective = detail.objective;
        }
        if (detail.methodology) {
            component.methodology = detail.methodology;
        }
        if (detail.learningAssessment) {
            component.learningAssessment = detail.learningAssessment;
        }
        if (detail.workload) {
            const fallback = component.workload || { theoretical: 0, practice: 0, internship: 0 };
            component.workload = {
                theoretical: detail.workload.theoretical || fallback.theoretical || 0,
                practice: detail.workload.practice || fallback.practice || 0,
                internship: detail.workload.internship || fallback.internship || 0,
            };

            if (typeof detail.workload.extension === 'number') {
                component.workloadExtension = detail.workload.extension;
            }
        }

        if (detail.coRequisites?.length) {
            component.coRequisites = detail.coRequisites;
        }

        if (detail.equivalences?.length) {
            component.equivalences = detail.equivalences;
        }
    }

    private async fetchSigaaComponentDetail(component: IComponentInfoCrawler): Promise<SigaaComponentDetail | null> {
        const requestSequence = this.getSigaaDetailRequestSequence(component);

        for (const request of requestSequence) {
            try {
                const response = request.method === 'GET'
                    ? await axios.get<ArrayBuffer>(request.url, {
                        responseType: 'arraybuffer',
                        responseEncoding: 'binary',
                        timeout: this.requestTimeoutMs,
                        headers: {
                            ...(component.detailRequestCookie ? { Cookie: component.detailRequestCookie } : {}),
                        },
                    })
                    : await axios.post<ArrayBuffer>(request.url, request.payload || '', {
                        responseType: 'arraybuffer',
                        responseEncoding: 'binary',
                        timeout: this.requestTimeoutMs,
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            ...(component.detailRequestCookie ? { Cookie: component.detailRequestCookie } : {}),
                        },
                    });

                const html = this.decodeHtmlBuffer(response.data);
                const $ = cheerio.load(html);
                const parsed = this.parseSigaaComponentDetailPage($);
                this.captureSigaaDetailDebugSnapshot(component, request, html, parsed);

                if (this.hasUsefulSigaaDetail(parsed)) {
                    return parsed;
                }
            } catch {
                continue;
            }
        }

        return null;
    }

    async enrichSigaaComponentsFromPublicDetails(
        components: Array<IComponentInfoCrawler>,
        concurrency = 4
    ): Promise<Array<IComponentInfoCrawler>> {
        const normalizedConcurrency = Math.max(1, concurrency);
        const detailCache = this.sigaaDetailCache || new Map<string, SigaaComponentDetail | null>();
        const inFlightCache = this.sigaaDetailInFlight || new Map<string, Promise<SigaaComponentDetail | null>>();
        this.sigaaDetailCache = detailCache;
        this.sigaaDetailInFlight = inFlightCache;
        const enriched = [...components];
        let cursor = 0;

        const workers = new Array(normalizedConcurrency).fill(null).map(async () => {
            while (cursor < enriched.length) {
                const index = cursor;
                cursor += 1;
                const current = enriched[index];

                if (!current.detailUrl && !current.detailActionPayload) {
                    continue;
                }

                const cacheKey = this.getDetailCacheKey(current);
                if (detailCache.has(cacheKey)) {
                    const cachedDetail = detailCache.get(cacheKey);

                    if (cachedDetail) {
                        this.applySigaaDetailToComponent(current, cachedDetail);
                    }
                    continue;
                }

                const detail = await this.getOrFetchSigaaComponentDetail(
                    cacheKey,
                    current,
                    detailCache,
                    inFlightCache
                );

                if (!detail) {
                    continue;
                }

                this.applySigaaDetailToComponent(current, detail);
            }
        });

        await Promise.all(workers);
        return enriched;
    }

    private extractSigaaListRows(
        $: CheerioAPI,
        sourceType: 'department' | 'program',
        academicLevel: AcademicLevel,
        detailRequestCookie?: string
    ): Array<IComponentInfoCrawler> {
        const foundItems = new Map<string, IComponentInfoCrawler>();
        const formContexts = this.buildSigaaFormContexts($);
        const pageDepartmentLabel =
            $('h1, h2')
                .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
                .toArray()
                .find((text) => /departamento|programa|computa|informa/i.test(text)) || '';

        $('tr').each((_, row) => {
            const $row = $(row);
            const rowCells = $row
                .find('td')
                .map((__, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
                .toArray()
                .filter(Boolean);

            // Ignore layout rows and JSF scaffolding rows that do not represent components.
            if (rowCells.length < 2) {
                return;
            }

            const rowClass = String($row.attr('class') || '').toLowerCase();
            const hasResultRowClass = /linha(par|impar)/.test(rowClass);

            if (!hasResultRowClass && rowCells.length < 3) {
                return;
            }

            const code = this.findCodeFromRowCells(rowCells);

            if (!code) {
                return;
            }

            if (rowCells.some((cell) => /n[íi]vel de ensino|tipo do componente|unidade respons[aá]vel/i.test(cell))) {
                return;
            }

            const nameCell = rowCells
                .slice(0, 3)
                .find((cell) => !cell.includes(code) && cell.length >= 4);
            const rawName = (nameCell || rowCells.join(' '))
                .replace(code, '')
                .replace(/^[-:\s]+/, '')
                .replace(/\s+CH\s+.*/i, '')
                .trim();
            const name = (rawName || `Disciplina ${code}`).slice(0, 255);

            const departmentCell = rowCells.find((cell) => /\b(departamento|instituto)\b/i.test(cell));
            const programCell = sourceType === 'program'
                ? rowCells.find((cell) => /\bprograma\b/i.test(cell) && !/\/[A-Z]{2,6}[0-9]{2,4}/i.test(cell))
                : undefined;

            const department = this.normalizeDepartmentLabel(
                departmentCell || programCell || pageDepartmentLabel,
                sourceType
            );

            const totalHours = this.extractSigaaWorkloadHours(rowCells);
            const componentType = this.extractSigaaComponentType(rowCells);
            const detailHref =
                $row
                    .find('a')
                    .map((__, anchor) => $(anchor).attr('href') || '')
                    .toArray()
                    .find((href) => /componente|curriculo|programa|portal\.jsf/i.test(href));
            const detailUrl = this.normalizeSigaaDetailUrl(detailHref);
            const detailAction = this.extractSigaaDetailActionFromRow($, $row, formContexts);
            const rowIdentity = [
                code,
                detailAction.detailActionPayload || '',
                (detailAction.detailActionPayloadCandidates || []).join('|'),
                detailAction.detailActionUrl || '',
                detailUrl || '',
                name,
            ].join('|');

            foundItems.set(rowIdentity, {
                code,
                name,
                department,
                semester: '',
                description: 'Conteúdo programático não disponível na listagem pública do SIGAA.',
                objective: '',
                syllabus: 'Ementa não disponível na listagem pública do SIGAA.',
                bibliography: '',
                prerequeriments: 'NAO_SE_APLICA',
                methodology: '',
                modality: componentType,
                learningAssessment: '',
                academicLevel,
                workload: {
                    theoretical: totalHours,
                    practice: 0,
                    internship: 0,
                },
                detailUrl,
                detailActionUrl: detailAction.detailActionUrl,
                detailActionPayload: detailAction.detailActionPayload,
                detailActionPayloadCandidates: detailAction.detailActionPayloadCandidates,
                detailRequestCookie,
            });
        });

        return Array.from(foundItems.values());
    }

    async createComponent(userId: string, data: IComponentInfoCrawler) {
        const componentExists = await this.componentRepository.findOne({
            where: { code: data.code },
        });

        if (componentExists) {
            throw new AppError('Component already exists.', 400);
        }

        try {
            const [ componentWorkload, draftWorkload ] = await Promise.all(
                new Array(2)
                    .fill(null)
                    .map(() => this.workloadService.create({
                        studentPractice: data.workload?.practice,
                        studentTheory: data.workload?.theoretical,
                        studentInternship: data.workload?.internship,
                        studentExtension: data.workloadExtension ?? data.workload?.extension ?? 0,
                    }))
            );

            const component = this.componentRepository.create({
                userId,
                workloadId: componentWorkload.id,
                code: data.code,
                name: data.name,
                department: data.department,
                semester: data.semester,
                program: data.description,
                objective: data.objective,
                syllabus: data.syllabus,
                bibliography: data.bibliography,
                academicLevel: data.academicLevel ?? AcademicLevel.GRADUATION,
                status: ComponentStatus.PUBLISHED,
                prerequeriments: this.normalizePrerequeriments(data.prerequeriments),
                methodology: data.methodology?.trim() || 'Não há Metodologia cadastrada',
                modality: data.modality?.trim() || 'Não há Modalidade cadastrada',
                learningAssessment: data.learningAssessment?.trim() || 'Não há Avaliação de Aprendizagem cadastrada'
            });
            await this.componentRepository.save(component);

            const normalizeRelationCodes = (rawList?: string[]) => {
                const normalized = (rawList || [])
                    .map((value) => String(value || '').trim().toUpperCase())
                    .filter((value) => !!value && value !== component.code);

                return Array.from(new Set(normalized));
            };

            const coRequisiteCodes = normalizeRelationCodes(data.coRequisites);
            const equivalenceCodes = normalizeRelationCodes(data.equivalences);
            const relationsToPersist = [
                ...coRequisiteCodes.map((relatedCode) => this.componentRelationRepository.create({
                    componentId: component.id,
                    relationType: ComponentRelationType.CO_REQUISITE,
                    relatedCode,
                })),
                ...equivalenceCodes.map((relatedCode) => this.componentRelationRepository.create({
                    componentId: component.id,
                    relationType: ComponentRelationType.EQUIVALENCE,
                    relatedCode,
                })),
            ];

            if (relationsToPersist.length > 0) {
                await this.componentRelationRepository.save(relationsToPersist);
            }

            const draft = this.componentDraftRepository.create({
                ...component,
                id: undefined,
                workloadId: draftWorkload.id,
                status: undefined,
                componentId: component.id
            } as unknown as ComponentDraft);

            const componentLog = component.generateLog(userId, ComponentLogType.CREATION);
            await Promise.all([
                this.componentLogRepository.save(componentLog),
                this.componentDraftRepository.save(draft)
            ]);

            await this.componentRepository.save({ id: component.id, draftId: draft.id });
        }
        catch (err) {
            throw new AppError('An error has been occurred.', 400);
        }
    }

    async importComponentsFromSiac(userId: string, cdCurso: string, nuPerCursoInicial: string): Promise<ImportComponentsSummary> {
        const listUrl =
            'https://alunoweb.ufba.br/SiacWWW/ListaDisciplinasEmentaPublico.do?cdCurso=' +
            encodeURIComponent(cdCurso) +
            '&nuPerCursoInicial=' +
            encodeURIComponent(nuPerCursoInicial);

        const options1: AxiosRequestConfig = {
            method: 'get',
            url: listUrl,
            responseType: 'arraybuffer',
            responseEncoding: 'binary',
            timeout: this.requestTimeoutMs,
            headers: {
                'Content-type': 'application/json'
            },
        };
        const options2: AxiosRequestConfig = {
            method: 'get',
            url: '',
            responseType: 'arraybuffer',
            responseEncoding: 'binary',
            timeout: this.requestTimeoutMs,
            headers: {
                'Content-type': 'application/json'
            },
        };

        function getCourseUrls($: CheerioAPI) {
            return $('table').eq(2).find('tr')
                .map((_: any, lesson: any) => {
                    const $lesson = $(lesson);
                    const href = $lesson.find('td:nth-child(3) a').attr('href');

                    if (!href || !href.includes('ExibirEmentaPublico.do')) {
                        return null;
                    }

                    return 'https://alunoweb.ufba.br' + href;
                })
                .toArray()
                .filter(Boolean);
        }

        const extractCourseInfo = ($: CheerioAPI): Array<IComponentInfoCrawler> => {
            return $('table').eq(1)
                .map((_: any, lesson: any) => {
                    const $lesson = $(lesson);

                    const content = $lesson.find('.even').children();
                    const rows = content.map((_, a) => a.children[0]);
                    const rawData: string[] = rows.map((_, x) => $(x).text().trim()).toArray();

                    if (!rawData.length || !rawData[0]) {
                        return null;
                    }

                    const [ code, componentName ] = rawData[0].split('-');

                    if (!code || !componentName) {
                        return null;
                    }

                    return {
                        code: code.trim(),
                        name: componentName.trim(),
                        department: rawData[4],
                        semester: rawData[5],
                        description: rawData[6],
                        objective: rawData[7],
                        syllabus: rawData[8],
                        bibliography: rawData[9],
                        status: ComponentStatus.PUBLISHED,
                        prerequeriments: this.extractPrerequerimentsFromLesson($lesson),
                        methodology: 'Não há Metodologia cadastrada',
                        modality: 'Não há Modalidade cadastrada',
                        learningAssessment: 'Não há Avaliação de Aprendizagem cadastrada',
                        workload: {
                            theoretical: Number(rawData[1]),
                            practice: Number(rawData[2]),
                            internship: Number(rawData[3]),
                        }
                    };
                })
                .toArray()
                .filter(Boolean) as Array<IComponentInfoCrawler>;
            };

        const { data } = await axios(options1);

        const html = this.decodeHtmlBuffer(data);
        const $ = cheerio.load(html);
        const urlList = getCourseUrls($);
        const responses = await Promise.allSettled(urlList.map((url) => axios({ ...options2, url })));
        let requested = 0;
        let created = 0;
        let skippedExisting = 0;
        let reconciled = 0;
        let failed = 0;
        const failures: string[] = [];
        const failureCategories: Record<string, number> = {};

        const fulfilledResponses = responses
            .map((result, index) => ({ result, index }))
            .filter((entry): entry is { result: PromiseFulfilledResult<any>; index: number } => entry.result.status === 'fulfilled')
            .map((entry) => entry.result.value);

        for (const rejected of responses
            .map((result, index) => ({ result, index }))
            .filter((entry): entry is { result: PromiseRejectedResult; index: number } => entry.result.status === 'rejected')) {
            failed += 1;
            const category = this.classifyImportFailure(rejected.result.reason);
            this.incrementFailureCategory(failureCategories, category);
            failures.push(`SIAC_URL_${rejected.index}: Failed to collect source page (${category}).`);
        }

        for (const response of fulfilledResponses) {
            const html = this.decodeHtmlBuffer(response.data);
            const $ = cheerio.load(html);
            const courseInfo = extractCourseInfo($);
            requested += courseInfo.length;

            for (const componentData of courseInfo) {
                try {
                    const sanitized = this.sanitizeImportedComponentData(componentData);
                    await this.createComponent(userId, sanitized);
                    created += 1;
                } catch (err) {
                    const appError = err as AppError;

                    if (appError.message === 'Component already exists.') {
                        const wasReconciled = await this.reconcileExistingComponentFromCrawlerData(componentData);

                        if (wasReconciled) {
                            reconciled += 1;
                        }
                        skippedExisting += 1;
                        continue;
                    }

                    failed += 1;
                    this.incrementFailureCategory(failureCategories, this.classifyImportFailure(err));
                    failures.push(`${componentData.code || 'UNKNOWN'}: ${appError.message || 'Unexpected error.'}`);
                }
            }
        }

        return {
            source: 'siac',
            requested,
            created,
            skippedExisting,
            reconciled,
            failed,
            failures,
            failureCategories,
        } as ImportComponentsSummary;
    }

    async importComponentsFromSigaaPublic(
        userId: string,
        sourceType: 'department' | 'program',
        sourceId: string,
        academicLevel: AcademicLevel | 'all',
        options?: {
            reconcileExisting?: boolean;
            maxComponents?: number;
            enrichDetails?: boolean;
            offset?: number;
            requestTimeoutMs?: number;
        }
    ): Promise<ImportComponentsSummary> {
        const levels: AcademicLevel[] = academicLevel === 'all'
            ? [AcademicLevel.GRADUATION, AcademicLevel.MASTERS, AcademicLevel.DOCTORATE]
            : [academicLevel];

        if (levels.length > 1) {
            const combined: ImportComponentsSummary = {
                source: 'sigaa-public',
                requested: 0,
                created: 0,
                skippedExisting: 0,
                reconciled: 0,
                failed: 0,
                failures: [],
                failureCategories: {},
            };

            for (const level of levels) {
                const partial = await this.importComponentsFromSigaaPublic(userId, sourceType, sourceId, level, options);
                combined.requested += partial.requested;
                combined.created += partial.created;
                combined.skippedExisting += partial.skippedExisting;
                combined.reconciled = (combined.reconciled || 0) + (partial.reconciled || 0);
                combined.failed += partial.failed;
                combined.failures.push(...(partial.failures || []));

                Object.entries(partial.failureCategories || {}).forEach(([key, value]) => {
                    combined.failureCategories[key] = (combined.failureCategories[key] || 0) + value;
                });
            }

            combined.failures = Array.from(new Set(combined.failures));
            return combined;
        }

        const level = levels[0];
        const shouldReconcileExisting = options?.reconcileExisting ?? true;
        const shouldEnrichDetails = options?.enrichDetails ?? true;
        const maxComponents = Number.isFinite(options?.maxComponents)
            ? Math.max(1, Number(options?.maxComponents))
            : undefined;
        const offset = Number.isFinite(options?.offset)
            ? Math.max(0, Number(options?.offset))
            : 0;
        const requestTimeoutMs = Number.isFinite(options?.requestTimeoutMs)
            ? Math.max(1000, Number(options?.requestTimeoutMs))
            : this.requestTimeoutMs;
        const normalizedSourceId = String(sourceId).trim();
        this.requestTimeoutMs = requestTimeoutMs;

        if (!normalizedSourceId) {
            throw new AppError('Invalid SIGAA source id.', 400);
        }

        const sourceUrls = this.getSigaaSourceUrls(sourceType, normalizedSourceId, level);
        let componentsInfo: Array<IComponentInfoCrawler> = [];
        let failed = 0;
        const failures: string[] = [];
        const failureCategories: Record<string, number> = {};

        for (const sourceUrl of sourceUrls) {
            let data: ArrayBuffer;

            try {
                const response = await this.executeSigaaRequestWithRetry(
                    `sigaa-source:${sourceType}:${normalizedSourceId}:${level}`,
                    () => axios.get<ArrayBuffer>(sourceUrl, {
                        responseType: 'arraybuffer',
                        responseEncoding: 'binary',
                        timeout: requestTimeoutMs,
                    })
                );
                const sourceCookie = this.buildCookieHeader(response.headers?.['set-cookie']);
                data = response.data;

                const html = this.decodeHtmlBuffer(data);
                const $ = cheerio.load(html);

                componentsInfo = this.extractSigaaListRows($, sourceType, level, sourceCookie);

                if (componentsInfo.length > 0) {
                    break;
                }
            } catch (error) {
                failed += 1;
                const category = this.classifyImportFailure(error);
                this.incrementFailureCategory(failureCategories, category);
                failures.push(`SIGAA_SOURCE: ${sourceUrl} (${category}).`);
                continue;
            }
        }

        if (componentsInfo.length === 0) {
            try {
                componentsInfo = await this.searchSigaaComponentsByUnit(sourceType, normalizedSourceId, level);
            } catch (error) {
                failed += 1;
                const category = this.classifyImportFailure(error);
                this.incrementFailureCategory(failureCategories, category);
                failures.push(`SIGAA_SEARCH: ${sourceType}:${normalizedSourceId}:${level} (${category}).`);
            }
        }

        if (componentsInfo.length === 0) {
            if (failed > 0) {
                return {
                    source: 'sigaa-public',
                    requested: 0,
                    created: 0,
                    skippedExisting: 0,
                    failed,
                    failures,
                    failureCategories,
                } as ImportComponentsSummary;
            }

            throw new AppError('No components found in SIGAA public source.', 404);
        }

        if (shouldEnrichDetails) {
            componentsInfo = await this.enrichSigaaComponentsFromPublicDetails(componentsInfo, 4);
        }

        const canonicalComponentsRaw = this
            .selectCanonicalComponentsByCode(componentsInfo)
            .sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'pt-BR'));
        const canonicalComponents = maxComponents
            ? canonicalComponentsRaw.slice(offset, offset + maxComponents)
            : canonicalComponentsRaw.slice(offset);

        let created = 0;
        let skippedExisting = 0;
        let reconciled = 0;

        for (const componentData of canonicalComponents) {
            try {
                const sanitized = this.sanitizeImportedComponentData(componentData);
                await this.createComponent(userId, sanitized);
                created += 1;
            } catch (err) {
                const appError = err as AppError;

                if (appError.message === 'Component already exists.') {
                    if (shouldReconcileExisting) {
                        const wasReconciled = await this.reconcileExistingComponentFromCrawlerData(componentData);

                        if (wasReconciled) {
                            reconciled += 1;
                        }
                    }
                    skippedExisting += 1;
                    continue;
                }

                failed += 1;
                this.incrementFailureCategory(failureCategories, this.classifyImportFailure(err));
                failures.push(`${componentData.code || 'UNKNOWN'}: ${appError.message || 'Unexpected error.'}`);
            }
        }

        return {
            source: 'sigaa-public',
            requested: canonicalComponents.length,
            created,
            skippedExisting,
            reconciled,
            failed,
            failures,
            failureCategories,
            totalAvailable: canonicalComponentsRaw.length,
            processed: canonicalComponents.length,
            hasMore: offset + canonicalComponents.length < canonicalComponentsRaw.length,
            nextOffset: offset + canonicalComponents.length < canonicalComponentsRaw.length
                ? offset + canonicalComponents.length
                : undefined,
        } as ImportComponentsSummary;
    }

}
