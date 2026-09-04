import { Brackets, getCustomRepository, QueryFailedError, Repository, getConnection, Raw } from 'typeorm';
import crypto from 'crypto';
import { ComponentDraftRepository } from '../repositories/ComponentDraftRepository';
import { AppError } from '../errors/AppError';
import { WorkloadService } from './WorkloadService';
import { ComponentDraft } from '../entities/ComponentDraft';
import { ComponentRepository } from '../repositories/ComponentRepository';
import { Component } from '../entities/Component';
import { ComponentLog } from '../entities/ComponentLog';
import { ComponentStatus } from '../interfaces/ComponentStatus';
import { ComponentWorkload } from '../entities/ComponentWorkload';
import { ComponentLogType } from '../interfaces/ComponentLogType';
import { ApproveDraftRequestDto } from '../dtos/component/draft/ApproveDraftRequest';
import { CreateDraftRequestDto } from '../dtos/component/draft/CreateDraftRequest';
import { UpdateComponentRequestDto } from '../dtos/component';
import { ComponentLogRepository } from '../repositories/ComponentLogRepository';
import { User } from '../entities/User';
import { UserRepository } from '../repositories/UserRepository';
import {
    composeBibliographySections,
    formatAbntReferenceBlock,
    hasNonWebReferenceWithoutYear,
    normalizeReferenceSections,
    splitBibliographySections,
} from '../helpers/referenceSections';
import { CourseResolutionService } from './CourseResolutionService';
import { ApiErrorCode } from '../errors/ApiErrorCode';

export class ComponentDraftService {

    private readonly approvalAgreementNumberUniqueIndex = 'UQ_component_logs_approval_agreement_number_normalized';

    private componentDraftRepository : Repository<ComponentDraft>;
    private componentRepository: Repository<Component>;
    private componentLogRepository: Repository<ComponentLog>;
    private userRepository: Repository<User>;
    private workloadService: WorkloadService;
    private courseResolutionService: CourseResolutionService;

    private readonly mutableDraftFields: Array<keyof UpdateComponentRequestDto> = [
        'code',
        'name',
        'department',
        'courseId',
        'program',
        'semester',
        'prerequeriments',
        'methodology',
        'objective',
        'syllabus',
        'bibliography',
        'referencesBasic',
        'referencesComplementary',
        'modality',
        'learningAssessment',
        'academicLevel',
        'workloadId',
        'workload',
    ];

    constructor() {
        this.componentDraftRepository = getCustomRepository(ComponentDraftRepository);
        this.componentRepository = getCustomRepository(ComponentRepository);
        this.componentLogRepository = getCustomRepository(ComponentLogRepository);
        this.userRepository = getCustomRepository(UserRepository);
        this.workloadService = new WorkloadService();
        this.courseResolutionService = new CourseResolutionService();
    }

    private getAutomaticAgreementDate(now = new Date()) {
        const timeZone = String(process.env.APP_TIME_ZONE || 'America/Bahia').trim() || 'America/Bahia';
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(now);
        const readPart = (type: Intl.DateTimeFormatPartTypes) => Number(
            parts.find((part) => part.type === type)?.value
        );

        return new Date(Date.UTC(readPart('year'), readPart('month') - 1, readPart('day'), 12, 0, 0));
    }

    private async getNextAgreementNumber(
        agreementDate: Date,
        repository: Repository<ComponentLog> = this.componentLogRepository
    ) {
        const year = String(agreementDate.getUTCFullYear());
        const prefix = `ATA-${year}-`;
        const pattern = new RegExp(`^${prefix}(\\d+)$`, 'i');
        const approvalLogs = await repository.find({
            where: {
                type: ComponentLogType.APPROVAL,
                agreementNumber: Raw(
                    (alias) => `UPPER(BTRIM(${alias})) LIKE :agreementPrefix`,
                    { agreementPrefix: `${prefix}%` }
                ),
            },
        });
        const maxSequence = approvalLogs
            .map((log) => String(log.agreementNumber || '').trim().match(pattern)?.[1])
            .filter((value): value is string => Boolean(value))
            .map(Number)
            .filter((value) => Number.isInteger(value) && value > 0)
            .reduce((maximum, current) => Math.max(maximum, current), 0);

        return `${prefix}${String(maxSequence + 1).padStart(3, '0')}`;
    }

    async getPublicationContext(draftId: string, userId: string) {
        const [ draft, approver ] = await Promise.all([
            this.componentDraftRepository.findOne({ where: { id: draftId } }),
            this.userRepository.findOne({
                where: { id: userId, isDeleted: false, isUserActive: true },
            }),
        ]);

        if (!draft) {
            throw AppError.fromCode(ApiErrorCode.DRAFT_NOT_FOUND);
        }

        if (!approver) {
            throw AppError.fromCode(ApiErrorCode.AUTH_USER_UNAVAILABLE);
        }

        const agreementDate = this.getAutomaticAgreementDate();

        return {
            agreementDate: agreementDate.toISOString(),
            agreementNumber: await this.getNextAgreementNumber(agreementDate),
            approverName: approver.name,
            hasVisualSignature: Boolean(
                approver.signatureFileKey
                && approver.signatureFileProvider
                && approver.signatureFileContentType?.startsWith('image/')
            ),
            agreementRule: 'ATA-{ANO}-{SEQUENCIA_GLOBAL_ANUAL_COM_3_DIGITOS}',
        };
    }

    private buildApprovalVersionCode(agreementDate: Date | string, agreementNumber: string) {
        const referenceDate = new Date(agreementDate);

        if (Number.isNaN(referenceDate.getTime())) {
            return agreementNumber;
        }

        const day = String(referenceDate.getUTCDate()).padStart(2, '0');
        const month = String(referenceDate.getUTCMonth() + 1).padStart(2, '0');
        const year = String(referenceDate.getUTCFullYear());

        return `${day}${month}${year}${agreementNumber}`;
    }

    private extractPrerequerimentCodes(value?: string) {
        if (!value) {
            return [];
        }

        return Array.from(new Set(value.toUpperCase().match(/\b[A-Z]{2,4}[0-9]{2,4}\b/g) ?? []));
    }

    private async normalizeAndValidatePrerequeriments(
        value: string | undefined,
        currentCode?: string
    ) {
        const rawValue = (value ?? '').trim();

        if (!rawValue || /^(n[aã]o\s+se\s+aplica|nenhum(a)?|n\/a|NAO_SE_APLICA)$/i.test(rawValue)) {
            return '';
        }

        const codes = this.extractPrerequerimentCodes(rawValue);

        if (codes.length === 0) {
            return rawValue;
        }

        const normalizedCurrentCode = currentCode?.toUpperCase();

        if (normalizedCurrentCode && codes.includes(normalizedCurrentCode)) {
            throw new AppError('Uma disciplina não pode ter a si mesma como pré-requisito.', 400);
        }

        return codes.join(', ');
    }

    private buildDraftUpdateDescription(
        draft: ComponentDraft,
        requestDto: UpdateComponentRequestDto,
        workloadPatch?: UpdateComponentRequestDto['workload']
    ) {
        const changedFields: string[] = [];
        const criticalChanges: string[] = [];

        const scalarFields: Array<keyof UpdateComponentRequestDto> = [
            'code',
            'name',
            'department',
            'semester',
            'modality',
            'program',
            'objective',
            'syllabus',
            'methodology',
            'learningAssessment',
            'bibliography',
            'referencesBasic',
            'referencesComplementary',
            'prerequeriments',
        ];

        scalarFields.forEach((field) => {
            const nextValue = requestDto[field];

            if (nextValue === undefined) {
                return;
            }

            const previousValue = draft[field as keyof ComponentDraft];

            if (previousValue !== nextValue) {
                changedFields.push(String(field));

                if (field === 'program') {
                    criticalChanges.push(`program: "${String(previousValue ?? '')}" -> "${String(nextValue)}"`);
                }
            }
        });

        if (workloadPatch) {
            const currentWorkload = draft.workload ?? {};

            Object.entries(workloadPatch).forEach(([ key, nextValue ]) => {
                if (nextValue === undefined) {
                    return;
                }

                const previousValue = (currentWorkload as Record<string, unknown>)[key];

                if (previousValue !== nextValue) {
                    changedFields.push(`workload.${key}`);
                    criticalChanges.push(`workload.${key}: ${String(previousValue ?? 0)} -> ${String(nextValue)}`);
                }
            });
        }

        if (changedFields.length === 0) {
            return 'Rascunho alterado';
        }

        if (criticalChanges.length === 0) {
            return `Rascunho alterado: ${changedFields.join(', ')}`;
        }

        return `Rascunho alterado: ${changedFields.join(', ')} | detalhes: ${criticalChanges.join('; ')}`;
    }

    private sanitizeDraftUpdateDto(payload: UpdateComponentRequestDto) {
        const incoming = payload as Record<string, unknown>;
        const sanitized: UpdateComponentRequestDto = {};

        this.mutableDraftFields.forEach((field) => {
            const value = incoming[field as string];

            if (value !== undefined) {
                (sanitized as Record<string, unknown>)[field] = value;
            }
        });

        return sanitized;
    }

    private syncReferenceFields<T extends {
        bibliography?: string;
        referencesBasic?: string;
        referencesComplementary?: string;
    }>(payload: T) {
        const bibliography = payload.bibliography?.trim();
        const referencesBasic = payload.referencesBasic?.trim();
        const referencesComplementary = payload.referencesComplementary?.trim();

        if (referencesBasic !== undefined || referencesComplementary !== undefined) {
            const normalizedSections = normalizeReferenceSections(referencesBasic ?? '', referencesComplementary ?? '');
            payload.referencesBasic = normalizedSections.basic;
            payload.referencesComplementary = normalizedSections.complementary;
            payload.bibliography = composeBibliographySections(payload.referencesBasic, payload.referencesComplementary);

            return payload;
        }

        if (bibliography !== undefined) {
            const sections = splitBibliographySections(bibliography);
            payload.bibliography = bibliography;
            const normalizedSections = normalizeReferenceSections(sections.basic, sections.complementary);
            payload.referencesBasic = normalizedSections.basic;
            payload.referencesComplementary = normalizedSections.complementary;
        }

        return payload;
    }

    private validateRequiredFieldsForOfficialPublication(draft: ComponentDraft) {
        const requiredTextFields: Array<{ key: keyof ComponentDraft; label: string }> = [
            { key: 'department', label: 'Curso' },
            { key: 'syllabus', label: 'Ementa' },
            { key: 'objective', label: 'Objetivos' },
            { key: 'program', label: 'Conteúdo programático' },
            { key: 'methodology', label: 'Metodologia' },
            { key: 'learningAssessment', label: 'Avaliação da aprendizagem' },
        ];

        const missing = requiredTextFields
            .filter(({ key }) => !String(draft[key] || '').trim())
            .map(({ label }) => label);

        if (missing.length > 0) {
            throw AppError.fromCode(ApiErrorCode.PUBLICATION_REQUIRED_FIELDS, {
                details: { fields: missing },
            });
        }

        const referencesBasic = formatAbntReferenceBlock(draft.referencesBasic || '').trim();

        if (!referencesBasic) {
            throw AppError.fromCode(ApiErrorCode.PUBLICATION_REFERENCES_REQUIRED);
        }

        if (hasNonWebReferenceWithoutYear(referencesBasic)) {
            throw AppError.fromCode(ApiErrorCode.PUBLICATION_REFERENCE_YEAR_REQUIRED, {
                details: { section: 'referencesBasic' },
            });
        }

    }

    private isAgreementNumberUniqueViolation(error: unknown) {
        if (!(error instanceof QueryFailedError)) {
            return false;
        }

        const driverError = error.driverError as { code?: string; constraint?: string; message?: string };

        if (driverError?.code !== '23505') {
            return false;
        }

        if (driverError.constraint === this.approvalAgreementNumberUniqueIndex) {
            return true;
        }

        return driverError.message?.includes(this.approvalAgreementNumberUniqueIndex) ?? false;
    }

    async getDrafts(options?: {
        search?: string;
        sortBy?: string;
        sortOrder?: 'ASC' | 'DESC';
    }) {
        const search = options?.search?.trim().toLowerCase();
        const sortMap: Record<string, string> = {
            code: 'drafts.code',
            name: 'drafts.name',
            department: 'COALESCE(courseRef.name, drafts.department)',
            course: 'COALESCE(courseRef.name, drafts.department)',
            semester: 'drafts.semester',
            createdAt: 'drafts.createdAt',
            updatedAt: 'drafts.updatedAt',
        };
        const sortBy = sortMap[options?.sortBy ?? ''] ?? 'drafts.updatedAt';
        const sortOrder = options?.sortOrder ?? 'DESC';

        const query = this.componentDraftRepository
            .createQueryBuilder('drafts')
            .leftJoinAndSelect('drafts.courseRef', 'courseRef')
            .leftJoinAndSelect('drafts.departmentRef', 'departmentRef')
            .leftJoinAndSelect('drafts.workload', 'workload');

        if (search) {
            query.where(new Brackets((subQuery) => {
                subQuery
                    .where('LOWER(drafts.code) LIKE :search', { search: `%${search}%` })
                    .orWhere('LOWER(drafts.name) LIKE :search', { search: `%${search}%` });
            }));
        }

        const drafts = await query.orderBy(sortBy, sortOrder).getMany();

        return drafts;
    }

    async getDraftByCode(code: string) {
        const normalizedCode = code.trim().toLowerCase();

        const draft = await this.componentDraftRepository.findOne({
            where: {
                code: Raw((alias) => `LOWER(${alias}) = :code`, { code: normalizedCode })
            },
            relations: [ 'workload', 'logs', 'courseRef' ],
        });

        if (!draft) return null;

        return draft;
    }

    async create(
        userId: string,
        requestDto: CreateDraftRequestDto
    ){
        const normalizedCode = requestDto.code.trim().toUpperCase();
        const draftExists = await this.componentDraftRepository.findOne({
            where: { code: normalizedCode },
        });

        if (draftExists) {
            throw new AppError('Draft already exists.', 400);
        }

        try {
            const draftDto = {
                ...requestDto,
                code: normalizedCode,
                prerequeriments: await this.normalizeAndValidatePrerequeriments(
                    requestDto.prerequeriments,
                    normalizedCode
                ),
                userId: userId,
            } as CreateDraftRequestDto & { userId: string; courseId?: string | null; workloadId?: string };
            this.syncReferenceFields(draftDto);
            await this.courseResolutionService.applyCourse(draftDto);

            const [ draftWorkload, componentWorkload ] = await Promise.all([
                this.workloadService.create(draftDto.workload ?? {}),
                this.workloadService.create(draftDto.workload ?? {})
            ]);
            draftDto.workloadId = draftWorkload.id;

            delete draftDto.workload;

            const component = this.componentRepository.create({
                ...draftDto,
                status: ComponentStatus.DRAFT,
                workloadId: componentWorkload.id
            });
            await this.componentRepository.save(component);
            let componentLog = component.generateLog(userId, ComponentLogType.CREATION);
            componentLog = this.componentLogRepository.create(componentLog);

            const draft = this.componentDraftRepository.create({ ...draftDto, componentId: component.id });
            await Promise.all([
                this.componentDraftRepository.save(draft),
                this.componentLogRepository.save(componentLog),
            ]);

            await this.componentRepository.save({ ...component, draftId: draft.id });

            return draft;
        }
        catch (err) {
            throw new AppError('An error has been occurred.', 400);
        }
    }

    async update(
        draftId: string,
        userId: string,
        requestDto: UpdateComponentRequestDto,
    ) {
        const sanitizedRequestDto = this.sanitizeDraftUpdateDto(requestDto);
        const draftExists = await this.componentDraftRepository.findOne({
            where: { id: draftId },
            relations: [ 'workload' ],
        });
        if(!draftExists){
            throw AppError.fromCode(ApiErrorCode.DRAFT_NOT_FOUND);
        }

        const nextCode = sanitizedRequestDto.code?.trim().toUpperCase();
        const codeDraft = nextCode && nextCode !== draftExists.code
            ? await this.componentDraftRepository.findOne({ where: { code: nextCode } })
            : null;
        if(codeDraft) {
            throw AppError.fromCode(ApiErrorCode.DRAFT_CODE_CONFLICT);
        }

        try {
            const workloadPatch = sanitizedRequestDto.workload == null
                ? undefined
                : { ...sanitizedRequestDto.workload };
            let savedWorkload = draftExists.workload;

            if (nextCode) {
                sanitizedRequestDto.code = nextCode;
            }

            if (sanitizedRequestDto.prerequeriments !== undefined) {
                sanitizedRequestDto.prerequeriments = await this.normalizeAndValidatePrerequeriments(
                    sanitizedRequestDto.prerequeriments,
                    nextCode ?? draftExists.code
                );
            }

            this.syncReferenceFields(sanitizedRequestDto);
            await this.courseResolutionService.applyCourse(sanitizedRequestDto);

            if(sanitizedRequestDto.workload != null) {
                const workloadData = {
                    ...workloadPatch,
                    id: sanitizedRequestDto.workloadId ?? draftExists.workloadId as string,
                };
                const workload = await this.workloadService.upsert(workloadData);
                savedWorkload = workload || savedWorkload;
                sanitizedRequestDto.workloadId = workload?.id;
                delete sanitizedRequestDto.workload;
            }

            const connection = getConnection();
            const queryRunner = connection.createQueryRunner();
            await queryRunner.connect();

            try {
                await queryRunner.startTransaction();

                const [ updatedDraft ] = await Promise.all([
                    queryRunner.manager.save(
                        ComponentDraft,
                        {
                            ...draftExists,
                            ...sanitizedRequestDto
                        }
                    ),
                    queryRunner.manager.save(
                        ComponentLog,
                        {
                            ...draftExists.generateDraftLog(
                                ComponentLogType.DRAFT_UPDATE,
                                userId
                            ),
                            description: this.buildDraftUpdateDescription(
                                draftExists,
                                sanitizedRequestDto,
                                workloadPatch
                            ),
                        }
                    ),
                ]); 

                await queryRunner.commitTransaction();

                updatedDraft.workload = savedWorkload;

                return updatedDraft;
            } catch (err) {
                if (queryRunner.isTransactionActive) {
                    await queryRunner.rollbackTransaction();
                }

                throw err;
            } finally {
                await queryRunner.release();
            }
        }
        catch (err) {
            if (err instanceof AppError) {
                throw err;
            }

            throw AppError.fromCode(ApiErrorCode.DRAFT_SAVE_FAILED);
        }
    }

    async delete(id: string){
        const componentExists = await this.componentDraftRepository.findOne({
            where: { id }
        });

        if(!componentExists){
            throw new AppError('Draft not found.', 404);
        }

        await this.componentDraftRepository.delete(id);
            
        if (componentExists.workloadId != null)
            await this.workloadService.delete(componentExists.workloadId);
    }

    async approve(
        draftId: string,
        approvalDto: ApproveDraftRequestDto,
        userId: string
    ) {
        try {
            if (!approvalDto.password) {
                throw AppError.fromCode(ApiErrorCode.PUBLICATION_PASSWORD_REQUIRED);
            }

            const approver = await this.userRepository
                .createQueryBuilder('user')
                .addSelect('user.password')
                .where('user.id = :userId', { userId })
                .andWhere('user.isDeleted = false')
                .andWhere('user.isUserActive = true')
                .getOne();

            if (!approver) {
                throw AppError.fromCode(ApiErrorCode.AUTH_USER_UNAVAILABLE);
            }

            const informedPasswordHash = crypto
                .createHmac('sha256', approvalDto.password)
                .digest('hex');

            if (informedPasswordHash !== approver.password) {
                throw AppError.fromCode(ApiErrorCode.PUBLICATION_PASSWORD_INVALID);
            }

            const draftExists = await this.componentDraftRepository.findOne({
                where: { id: draftId }
            });

            if(!draftExists){
                throw AppError.fromCode(ApiErrorCode.DRAFT_NOT_FOUND);
            }

            this.validateRequiredFieldsForOfficialPublication(draftExists);

            const [ currentPublishedComponent, draftWorkload ] = await Promise.all([
                this.componentRepository.findOne({
                    where: { id: draftExists.componentId },
                }),
                this.workloadService.getWorkloadById(draftExists.workloadId as string)
            ]) as [ Component, ComponentWorkload ];

            const connection = getConnection();
            const queryRunner = connection.createQueryRunner();
            await queryRunner.connect();

            try {
                await queryRunner.startTransaction();

                const agreementDate = this.getAutomaticAgreementDate();
                const agreementYear = agreementDate.getUTCFullYear();
                await queryRunner.query('SELECT pg_advisory_xact_lock($1)', [ 700000 + agreementYear ]);
                const agreementNumber = await this.getNextAgreementNumber(
                    agreementDate,
                    queryRunner.manager.getRepository(ComponentLog)
                );
                const component = currentPublishedComponent.publishDraft(draftExists);
                const versionCode = this.buildApprovalVersionCode(agreementDate, agreementNumber);
                const approvalLog = component.generateLog(
                    userId,
                    ComponentLogType.APPROVAL,
                    `Versão oficial ${versionCode} publicada por ${approver.name} após confirmação de senha.`,
                    agreementNumber,
                    agreementDate,
                    versionCode,
                    component.program,
                    component.syllabus,
                );

                const [ updatedComponent ] = await Promise.all([
                    queryRunner.manager.save(Component, component),
                    queryRunner.manager.save(ComponentLog, approvalLog),
                    queryRunner.manager.save(ComponentWorkload, { ...draftWorkload, id: currentPublishedComponent.workloadId }),
                    queryRunner.manager.update(
                        ComponentLog,
                        { draftId } as Partial<ComponentLog>,
                        { draftId: null, componentId: currentPublishedComponent.id }
                    )
                ]); 

                await queryRunner.commitTransaction();

                return updatedComponent;
            } catch (err) {
                if (queryRunner.isTransactionActive) {
                    await queryRunner.rollbackTransaction();
                }

                throw err;
            } finally {
                await queryRunner.release();
            }
        } catch (err) {
            if (this.isAgreementNumberUniqueViolation(err)) {
                throw AppError.fromCode(ApiErrorCode.PUBLICATION_AGREEMENT_CONFLICT);
            }

            if (err instanceof AppError) {
                throw err;
            }

            throw AppError.fromCode(ApiErrorCode.PUBLICATION_FAILED);
        }
    }

}
