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
import { DepartmentResolutionService } from './DepartmentResolutionService';

export class ComponentDraftService {

    private readonly approvalAgreementNumberUniqueIndex = 'UQ_component_logs_approval_agreement_number_normalized';

    private componentDraftRepository : Repository<ComponentDraft>;
    private componentRepository: Repository<Component>;
    private componentLogRepository: Repository<ComponentLog>;
    private userRepository: Repository<User>;
    private workloadService: WorkloadService;
    private departmentResolutionService: DepartmentResolutionService;

    private readonly mutableDraftFields: Array<keyof UpdateComponentRequestDto> = [
        'code',
        'name',
        'department',
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
        this.departmentResolutionService = new DepartmentResolutionService();
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

            Object.entries(workloadPatch).forEach(([key, nextValue]) => {
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
            throw new AppError(`Publicação oficial bloqueada. Campos obrigatórios ausentes: ${missing.join(', ')}.`, 400);
        }

        const referencesBasic = formatAbntReferenceBlock(draft.referencesBasic || '').trim();
        const referencesComplementary = formatAbntReferenceBlock(draft.referencesComplementary || '').trim();

        if (!referencesBasic) {
            throw new AppError('Publicação oficial bloqueada. Informe ao menos as referências básicas em formato ABNT.', 400);
        }

        if (hasNonWebReferenceWithoutYear(referencesBasic)) {
            throw new AppError('Publicação oficial bloqueada. Referências básicas não web devem conter ano de publicação (ex.: SILVA, J. Título. Salvador: Editora X, 2020).', 400);
        }

        if (referencesComplementary && hasNonWebReferenceWithoutYear(referencesComplementary)) {
            throw new AppError('Publicação oficial bloqueada. Referências complementares não web devem conter ano de publicação (ex.: SOUZA, M. Título. São Paulo: Editora Y, 2021).', 400);
        }
    }

    private async ensureAgreementNumberIsAvailable(agreementNumber: string) {
        const existingApproval = await this.componentLogRepository.findOne({
            where: {
                type: ComponentLogType.APPROVAL,
                agreementNumber: Raw(
                    (alias) => `LOWER(BTRIM(${alias})) = LOWER(BTRIM(:agreementNumber))`,
                    { agreementNumber }
                ),
            },
        });

        if (existingApproval) {
            throw new AppError('Número de ATA já utilizado em outra publicação oficial. Informe uma ATA/referência diferente.', 409);
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
            department: 'COALESCE(departmentRef.name, drafts.department)',
            semester: 'drafts.semester',
            createdAt: 'drafts.createdAt',
            updatedAt: 'drafts.updatedAt',
        };
        const sortBy = sortMap[options?.sortBy ?? ''] ?? 'drafts.updatedAt';
        const sortOrder = options?.sortOrder ?? 'DESC';

        const query = this.componentDraftRepository
            .createQueryBuilder('drafts')
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
            relations: [ 'workload', 'logs' ],
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
            } as CreateDraftRequestDto & { userId: string; departmentId?: string | null; workloadId?: string };
            this.syncReferenceFields(draftDto);
            await this.departmentResolutionService.applyDepartment(draftDto);

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
            throw new AppError('Draft not found.', 404);
        }

        const nextCode = sanitizedRequestDto.code?.trim().toUpperCase();
        const codeDraft = nextCode && nextCode !== draftExists.code
            ? await this.componentDraftRepository.findOne({ where: { code: nextCode } })
            : null;
        if(codeDraft) {
            throw new AppError('Invalid code', 400);
        }

        try {
            const workloadPatch = sanitizedRequestDto.workload == null
                ? undefined
                : { ...sanitizedRequestDto.workload };

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
            await this.departmentResolutionService.applyDepartment(sanitizedRequestDto);

            if(sanitizedRequestDto.workload != null) {
                const workloadData = {
                    ...workloadPatch,
                    id: sanitizedRequestDto.workloadId ?? draftExists.workloadId as string,
                };
                const workload = await this.workloadService.upsert(workloadData);
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

            throw new AppError('An error has been occurred.', 400);
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
            const normalizedAgreementNumber = approvalDto.agreementNumber.trim();

            if (!normalizedAgreementNumber) {
                throw new AppError('Informe a ATA ou referência de aprovação.', 400);
            }

            const approver = await this.userRepository.findOne({ where: { id: userId, isDeleted: false } });

            if (!approver) {
                throw new AppError('User not found.', 404);
            }

            if (!approver.signatureHash) {
                throw new AppError('Assinatura digital não configurada. Atualize sua assinatura no perfil antes de publicar.', 400);
            }

            const informedSignatureHash = crypto
                .createHmac('sha256', approvalDto.signature.trim())
                .digest('hex');

            if (informedSignatureHash !== approver.signatureHash) {
                throw new AppError('Assinatura inválida para publicação oficial.', 401);
            }

            const draftExists = await this.componentDraftRepository.findOne({
                where: { id: draftId }
            });

            if(!draftExists){
                throw new AppError('Draft not found.', 404);
            }

            this.validateRequiredFieldsForOfficialPublication(draftExists);
            await this.ensureAgreementNumberIsAvailable(normalizedAgreementNumber);

            const [ currentPublishedComponent, draftWorkload ] = await Promise.all([
                this.componentRepository.findOne({
                    where: { id: draftExists.componentId },
                }),
                this.workloadService.getWorkloadById(draftExists.workloadId as string)
            ]) as [ Component, ComponentWorkload ];

            const component = currentPublishedComponent.publishDraft(draftExists);
            const versionCode = this.buildApprovalVersionCode(
                approvalDto.agreementDate,
                normalizedAgreementNumber
            );

            const approvalLog = component.generateLog(
                userId,
                ComponentLogType.APPROVAL,
                `Versao oficial ${versionCode} publicada por aprovacao formal com assinatura validada.`,
                normalizedAgreementNumber,
                approvalDto.agreementDate,
                versionCode,
                component.program,
                component.syllabus,
            );

            const connection = getConnection();
            const queryRunner = connection.createQueryRunner();
            await queryRunner.connect();

            try {
                await queryRunner.startTransaction();

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
                throw new AppError('Número de ATA já utilizado em outra publicação oficial. Informe uma ATA/referência diferente.', 409);
            }

            if (err instanceof AppError) {
                throw err;
            }

            throw new AppError('Não foi possível concluir a publicação oficial da disciplina.', 400);
        }
    }

}
