import { Brackets, getCustomRepository, Raw, Repository } from 'typeorm';
import fs from 'fs';
import path from 'path';
const AdmZip = require('adm-zip');
import type { GenerateHtmlData } from '../helpers/templates/component';
import { Component } from '../entities/Component';
import { ComponentRepository } from '../repositories/ComponentRepository';
import { AppError } from '../errors/AppError';
import { WorkloadService } from './WorkloadService';
import { ComponentLog } from '../entities/ComponentLog';
import { ComponentLogRepository } from '../repositories/ComponentLogRepository';
import { ComponentLogType } from '../interfaces/ComponentLogType';
import { ComponentStatus } from '../interfaces/ComponentStatus';
import {
    CreateComponentRequestDto,
    UpdateComponentRequestDto,
} from '../dtos/component';
import { ComponentDraft } from '../entities/ComponentDraft';
import { ComponentDraftRepository } from '../repositories/ComponentDraftRepository';
import { AcademicLevel } from '../interfaces/AcademicLevel';
import {
    composeBibliographySections,
    formatAbntReferenceBlock,
    normalizeReferenceSections,
    splitBibliographySections,
} from '../helpers/referenceSections';
import type { DocxToPdfConverter } from './export/DocxToPdfConverter';
import { LibreOfficeDocxToPdfConverter } from './export/LibreOfficeDocxToPdfConverter';
import { DocxSignatureEmbedder } from './export/DocxSignatureEmbedder';
import { ProcessedSignatureImage } from './export/SignatureImageProcessor';
import { UserSignatureAssetService } from './export/UserSignatureAssetService';
import { DepartmentResolutionService } from './DepartmentResolutionService';
import { getCourseFilterAliases, normalizeCourseNameFromSource, normalizeProgrammaticSemester } from '../helpers/courseCatalog';

export class ComponentService {
    private componentRepository: Repository<Component>;
    private componentLogRepository: Repository<ComponentLog>;
    private componentDraftRepository: Repository<ComponentDraft>;
    private workloadService: WorkloadService;
    private readonly pdfConverter: DocxToPdfConverter;
    private readonly signatureAssetService: UserSignatureAssetService;
    private readonly docxSignatureEmbedder: DocxSignatureEmbedder;
    private readonly departmentResolutionService: DepartmentResolutionService;

    private readonly mutableComponentFields: Array<keyof UpdateComponentRequestDto> = [
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

    constructor(pdfConverter: DocxToPdfConverter = new LibreOfficeDocxToPdfConverter()) {
        this.componentRepository = getCustomRepository(ComponentRepository);
        this.componentLogRepository = getCustomRepository(
            ComponentLogRepository
        );
        this.componentDraftRepository = getCustomRepository(
            ComponentDraftRepository
        );
        this.workloadService = new WorkloadService();
        this.pdfConverter = pdfConverter;
        this.signatureAssetService = new UserSignatureAssetService();
        this.docxSignatureEmbedder = new DocxSignatureEmbedder();
        this.departmentResolutionService = new DepartmentResolutionService();
    }

    private normalizeTemplateText(value: string | undefined, emptyText = 'Não se aplica') {
        const normalized = value?.trim();

        if (!normalized) {
            return emptyText;
        }

        if (/^(n[aã]o\s+se\s+aplica|n\/a|NAO_SE_APLICA)$/i.test(normalized)) {
            return 'Não se aplica';
        }

        return normalized;
    }

    private normalizeSearch(value?: string) {
        if (!value) {
            return undefined;
        }

        return value
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    private normalizeComponentCourseForDisplay<T extends Component | ComponentDraft>(component: T) {
        const normalizedCourse = normalizeCourseNameFromSource(component.departmentRef?.name || component.department);

        if (normalizedCourse) {
            component.department = normalizedCourse;

            if (component.departmentRef) {
                component.departmentRef.name = normalizedCourse;
            }
        }

        component.semester = normalizeProgrammaticSemester(component.semester);

        if ('draft' in component && component.draft) {
            this.normalizeComponentCourseForDisplay(component.draft);
        }

        return component;
    }

    private sanitizeComponentUpdateDto(payload: UpdateComponentRequestDto) {
        const incoming = payload as Record<string, unknown>;
        const sanitized: UpdateComponentRequestDto = {};

        this.mutableComponentFields.forEach((field) => {
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

    private accentInsensitiveSql(column: string) {
        return `translate(LOWER(${column}), 'áàâãäåéèêëíìîïóòôõöúùûüçñ', 'aaaaaaeeeeiiiiooooouuuucn')`;
    }


    private isUuid(value?: string) {
        return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
    }

    private decodeXmlText(value: string) {
        return value
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&');
    }

    private encodeXmlText(value: string) {
        const sanitized = String(value)
            // Remove caracteres de controle inválidos em XML 1.0.
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
            // Remove pares substitutos inválidos para evitar XML corrompido.
            .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
            .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');

        return sanitized
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    private normalizeSectionText(value: string | undefined, emptyText = 'Não informado') {
        const normalized = String(value || '').replace(/\s+/g, ' ').trim();

        if (!normalized) {
            return emptyText;
        }

        return normalized;
    }

    private normalizeMultilineSectionText(
        value: string | undefined,
        emptyText = 'Não informado',
        options?: { indentParagraphs?: boolean }
    ) {
        const lines = String(value || '')
            .split(/\r?\n/)
            .map((line) => line.trimEnd());

        if (lines.every((line) => line.trim().length === 0)) {
            return emptyText;
        }

        if (options?.indentParagraphs) {
            return lines
                .map((line) => (line.trim().length > 0 ? `    ${line.trimStart()}` : ''))
                .join('\n');
        }

        return lines.join('\n');
    }

    private ensurePreserveSpaceAttribute(attrs: string, payload: string) {
        if (/\bxml:space\s*=\s*"preserve"/.test(attrs)) {
            return attrs;
        }

        if (/\s|\n/.test(payload)) {
            return `${attrs} xml:space="preserve"`;
        }

        return attrs;
    }

    private replaceParagraphText(paragraphXml: string, newText: string) {
        const sanitizedParagraphXml = this.stripParagraphNumbering(paragraphXml);
        let replaced = false;
        const normalizedLines = String(newText || '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .split('\n')
            .map((line) => line.trimEnd());
        const hasVisibleContent = normalizedLines.some((line) => line.trim().length > 0);
        const encodedPayload = this.encodeXmlText(
            hasVisibleContent ? normalizedLines.join('\n') : ''
        );

        if (!/<w:t(?=[\s>])/.test(sanitizedParagraphXml)) {
            if (/<w:pPr[\s\S]*?<\/w:pPr>/.test(sanitizedParagraphXml)) {
                return sanitizedParagraphXml.replace(
                    /(<w:pPr[\s\S]*?<\/w:pPr>)/,
                    `$1<w:r><w:t>${encodedPayload}</w:t></w:r>`
                );
            }

            return sanitizedParagraphXml.replace(
                /<w:p([^>]*)>/,
                `<w:p$1><w:r><w:t>${encodedPayload}</w:t></w:r>`
            );
        }

        return sanitizedParagraphXml.replace(/<w:t(?=[\s>])([^>]*)>[\s\S]*?<\/w:t>/g, (_match, attrs) => {
            if (!replaced) {
                replaced = true;
                const nextAttrs = this.ensurePreserveSpaceAttribute(attrs, hasVisibleContent ? normalizedLines.join('\n') : '');
                return `<w:t${nextAttrs}>${encodedPayload}</w:t>`;
            }

            return `<w:t${attrs}></w:t>`;
        });
    }

    private getParagraphPlainText(paragraphXml: string) {
        const texts = Array.from(paragraphXml.matchAll(/<w:t(?=[\s>])[^>]*>([\s\S]*?)<\/w:t>/g)).map((item) => this.decodeXmlText(item[1]));
        return texts.join('').replace(/\s+/g, ' ').trim();
    }

    private stripParagraphDrawings(paragraphXml: string) {
        return paragraphXml
            .replace(/<w:drawing[\s\S]*?<\/w:drawing>/g, '')
            .replace(/<w:pict[\s\S]*?<\/w:pict>/g, '');
    }

    private applyParagraphSpacing(
        paragraphXml: string,
        spacing: { before?: number; after?: number; line?: number; lineRule?: 'auto' | 'exact' | 'atLeast' }
    ) {
        const attrs = [
            spacing.before !== undefined ? `w:before="${spacing.before}"` : '',
            spacing.after !== undefined ? `w:after="${spacing.after}"` : '',
            spacing.line !== undefined ? `w:line="${spacing.line}"` : '',
            spacing.lineRule ? `w:lineRule="${spacing.lineRule}"` : '',
        ]
            .filter(Boolean)
            .join(' ');

        if (!attrs) {
            return paragraphXml;
        }

        const spacingNode = `<w:spacing ${attrs}/>`;

        if (!/<w:pPr[\s>]/.test(paragraphXml)) {
            return paragraphXml.replace(/<w:p([^>]*)>/, `<w:p$1><w:pPr>${spacingNode}</w:pPr>`);
        }

        if (/<w:pPr[\s\S]*?<w:spacing[\s\S]*?\/>[\s\S]*?<\/w:pPr>/.test(paragraphXml)) {
            return paragraphXml.replace(/<w:spacing[\s\S]*?\/>/, spacingNode);
        }

        if (/<w:pPr\s*\/>/.test(paragraphXml)) {
            return paragraphXml.replace(/<w:pPr\s*\/>/, `<w:pPr>${spacingNode}</w:pPr>`);
        }

        return paragraphXml.replace(/<w:pPr([\s\S]*?)>/, `<w:pPr$1>${spacingNode}`);
    }

    private applyParagraphAlignment(paragraphXml: string, alignment: 'left' | 'center' | 'right' | 'both') {
        const jcNode = `<w:jc w:val="${alignment}"/>`;

        if (!/<w:pPr[\s>]/.test(paragraphXml)) {
            return paragraphXml.replace(/<w:p([^>]*)>/, `<w:p$1><w:pPr>${jcNode}</w:pPr>`);
        }

        if (/<w:pPr[\s\S]*?<w:jc[\s\S]*?\/>[\s\S]*?<\/w:pPr>/.test(paragraphXml)) {
            return paragraphXml.replace(/<w:jc[\s\S]*?\/>/, jcNode);
        }

        if (/<w:pPr\s*\/>/.test(paragraphXml)) {
            return paragraphXml.replace(/<w:pPr\s*\/>/, `<w:pPr>${jcNode}</w:pPr>`);
        }

        return paragraphXml.replace(/<w:pPr([\s\S]*?)>/, `<w:pPr$1>${jcNode}`);
    }

    private stripParagraphNumbering(paragraphXml: string) {
        return paragraphXml
            .replace(/<w:numPr[\s\S]*?<\/w:numPr>/g, '')
            .replace(/<w:pStyle\s+w:val="ListParagraph"\s*\/>/g, '');
    }

    private formatPrerequerimentsForTemplate(value: string | undefined) {
        const normalized = this.normalizeTemplateText(value, 'Não se aplica');

        if (normalized === 'Não se aplica') {
            return normalized;
        }

        const items = normalized
            .split(/[\n;,]+/)
            .map((item) => item.trim())
            .filter((item) => item.length > 0);

        if (items.length === 0) {
            return 'Não se aplica';
        }

        return items.join(', ');
    }

    private normalizeModalityForTemplate(value: string | undefined) {
        const normalized = this.normalizeTemplateText(value, 'Não se aplica');

        if (normalized === 'Não se aplica') {
            return normalized;
        }

        return 'Disciplina Teórico /Prática';
    }

    private normalizeWorkloadCellParagraph(paragraphXml: string) {
        const withoutNumbering = this.stripParagraphNumbering(paragraphXml);
        const centered = this.applyParagraphAlignment(withoutNumbering, 'center');

        return this.applyParagraphSpacing(centered, {
            before: 0,
            after: 0,
            line: 200,
            lineRule: 'auto',
        });
    }

    private extractParagraphProperties(paragraphXml: string) {
        const match = paragraphXml.match(/<w:pPr[\s\S]*?<\/w:pPr>|<w:pPr\s*\/>/);
        return match ? match[0] : undefined;
    }

    private applyParagraphProperties(paragraphXml: string, paragraphPropertiesXml?: string) {
        if (!paragraphPropertiesXml) {
            return paragraphXml;
        }

        if (/<w:pPr[\s\S]*?<\/w:pPr>|<w:pPr\s*\/>/.test(paragraphXml)) {
            return paragraphXml.replace(/<w:pPr[\s\S]*?<\/w:pPr>|<w:pPr\s*\/>/, paragraphPropertiesXml);
        }

        return paragraphXml.replace(/<w:p([^>]*)>/, `<w:p$1>${paragraphPropertiesXml}`);
    }

    private fillDocxTemplateFromBase(data: GenerateHtmlData, signatureAsset?: ProcessedSignatureImage | null) {
        const templatePath = path.resolve(process.cwd(), 'UFBA_TEMPLATE.docx');

        if (!fs.existsSync(templatePath)) {
            throw new AppError('UFBA_TEMPLATE.docx não encontrado para exportação.', 500);
        }

        const zip = new AdmZip(templatePath);
        const documentXml = zip.readAsText('word/document.xml');
        const paragraphs = Array.from(documentXml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)) as RegExpMatchArray[];
        const updatedParagraphs = paragraphs.map((match) => match[0]);
        const texts = updatedParagraphs.map((paragraph) => this.getParagraphPlainText(paragraph));

        const sectionHeadersRaw = [
            'EMENTA',
            'OBJETIVOS',
            'OBJETIVO GERAL',
            'OBJETIVOS ESPECÍFICOS',
            'CONTEÚDO PROGRAMÁTICO',
            'METODOLOGIA DE ENSINO-APRENDIZAGEM',
            'AVALIAÇÃO DA APRENDIZAGEM',
            'REFERÊNCIAS',
            'REFERÊNCIAS BÁSICAS',
            'REFERÊNCIAS COMPLEMENTARES',
        ];
        const tailMarkers = [
            'Docente(s) Responsável(is)',
            'Aprovado em reunião de Departamento',
            'Assinatura do Chefe',
        ];

        const normalizeHeading = (value: string) => value
            .toUpperCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        const sectionHeaders = new Set(sectionHeadersRaw.map((header) => normalizeHeading(header)));
        const normalizedTailMarkers = tailMarkers.map((marker) => normalizeHeading(marker));
        const indexOfExact = (target: string, fromIndex = 0) => texts.findIndex(
            (text, index) => index >= fromIndex && normalizeHeading(text) === normalizeHeading(target)
        );
        const findNextHeadingIndex = (fromIndex: number) => {
            for (let index = fromIndex + 1; index < texts.length; index += 1) {
                const text = texts[index];
                const normalizedText = normalizeHeading(text);

                if (sectionHeaders.has(normalizedText)) {
                    return index;
                }

                if (normalizedTailMarkers.some((marker) => normalizedText.startsWith(marker))) {
                    return index;
                }
            }

            return texts.length;
        };

        const replaceIndex = (index: number, value: string) => {
            if (index < 0 || index >= updatedParagraphs.length) {
                return;
            }

            updatedParagraphs[index] = this.replaceParagraphText(updatedParagraphs[index], value);
            texts[index] = value;
        };

        const clearIndex = (index: number) => {
            replaceIndex(index, '');
        };

        const replaceSectionContent = (
            heading: string,
            value: string,
            options?: {
                preserveOnlyFirst?: boolean;
                spacing?: { before?: number; after?: number; line?: number; lineRule?: 'auto' | 'exact' | 'atLeast' };
                trailingSpacing?: { before?: number; after?: number; line?: number; lineRule?: 'auto' | 'exact' | 'atLeast' };
            }
        ) => {
            const headingIndex = indexOfExact(heading);

            if (headingIndex < 0) {
                return;
            }

            const nextHeadingIndex = findNextHeadingIndex(headingIndex);
            const contentIndexes: number[] = [];

            for (let index = headingIndex + 1; index < nextHeadingIndex; index += 1) {
                const text = texts[index];

                if (sectionHeaders.has(normalizeHeading(text))) {
                    continue;
                }

                contentIndexes.push(index);
            }

            if (contentIndexes.length === 0) {
                return;
            }

            replaceIndex(contentIndexes[0], value);

            if (options?.spacing) {
                updatedParagraphs[contentIndexes[0]] = this.applyParagraphSpacing(
                    updatedParagraphs[contentIndexes[0]],
                    options.spacing
                );
            }

            if (options?.preserveOnlyFirst !== false) {
                for (let index = 1; index < contentIndexes.length; index += 1) {
                    const trailingIndex = contentIndexes[index];
                    clearIndex(trailingIndex);
                    updatedParagraphs[trailingIndex] = this.stripParagraphNumbering(updatedParagraphs[trailingIndex]);

                    if (options?.trailingSpacing) {
                        updatedParagraphs[trailingIndex] = this.applyParagraphSpacing(
                            updatedParagraphs[trailingIndex],
                            options.trailingSpacing
                        );
                    }
                }
            }
        };

        const toReferenceLines = (value: string | undefined, emptyText: string) => {
            const lines = String(value || '')
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.length > 0);

            if (lines.length === 0) {
                return emptyText;
            }

            return lines.join('\n');
        };

        const bibliographySections = splitBibliographySections(data.bibliography);
        const referencesBasic = toReferenceLines(formatAbntReferenceBlock(data.referencesBasic || bibliographySections.basic), 'Não informado');
        const referencesComplementary = toReferenceLines(formatAbntReferenceBlock(data.referencesComplementary || bibliographySections.complementary), 'Não informado');

        // Preenche semestre com o valor recebido da API/front-end, sem depender de exemplos do template.
        const normalizedSemester = this.normalizeSectionText(normalizeProgrammaticSemester(data.semester), 'Não informado');
        texts.forEach((text, index) => {
            if (/^Semestre\s+\d{4}\.\d$/i.test(text)) {
                replaceIndex(index, `Semestre ${normalizedSemester}`);
            }
        });

        // Preenche valores de identificação (código, nome e departamento) por posição lógica dentro da seção.
        const identificationStart = indexOfExact('DADOS DE IDENTIFICAÇÃO E ATRIBUTOS');
        const studentWorkloadStart = indexOfExact('CARGA HORÁRIA (estudante)');
        if (identificationStart >= 0 && studentWorkloadStart > identificationStart) {
            const identificationLabels = new Set([
                normalizeHeading('CÓDIGO'),
                normalizeHeading('NOME'),
                normalizeHeading('DEPARTAMENTO OU EQUIVALENTE'),
            ]);
            const identificationLabelIndexes: number[] = [];
            const valueIndexes: number[] = [];

            for (let index = identificationStart + 1; index < studentWorkloadStart; index += 1) {
                const text = texts[index];

                if (!text) {
                    continue;
                }

                if (identificationLabels.has(normalizeHeading(text))) {
                    identificationLabelIndexes.push(index);
                    continue;
                }

                valueIndexes.push(index);
            }

            if (valueIndexes[0] !== undefined) {
                replaceIndex(valueIndexes[0], this.normalizeSectionText(data.code));
            }

            if (valueIndexes[1] !== undefined) {
                replaceIndex(valueIndexes[1], this.normalizeSectionText(data.name));
            }

            if (valueIndexes[2] !== undefined) {
                replaceIndex(valueIndexes[2], this.normalizeSectionText(data.department));
            }

            identificationLabelIndexes.forEach((index) => {
                updatedParagraphs[index] = this.applyParagraphAlignment(updatedParagraphs[index], 'center');
                updatedParagraphs[index] = this.applyParagraphSpacing(updatedParagraphs[index], {
                    before: 40,
                    after: 40,
                    line: 240,
                    lineRule: 'auto',
                });
            });

            valueIndexes.slice(0, 3).forEach((index) => {
                updatedParagraphs[index] = this.applyParagraphAlignment(updatedParagraphs[index], 'center');
                updatedParagraphs[index] = this.applyParagraphSpacing(updatedParagraphs[index], {
                    before: 40,
                    after: 40,
                    line: 240,
                    lineRule: 'auto',
                });
            });

            const filledValueIndexes = valueIndexes.slice(0, 3);
            if (identificationLabelIndexes.length > 0 && filledValueIndexes.length > 0) {
                const firstIdentificationIndex = Math.min(...identificationLabelIndexes, ...filledValueIndexes);
                const lastIdentificationIndex = Math.max(...identificationLabelIndexes, ...filledValueIndexes);
                for (let index = firstIdentificationIndex; index <= lastIdentificationIndex; index += 1) {
                    if (!texts[index]) {
                        updatedParagraphs[index] = this.applyParagraphAlignment(updatedParagraphs[index], 'center');
                        updatedParagraphs[index] = this.applyParagraphSpacing(updatedParagraphs[index], {
                            before: 40,
                            after: 40,
                            line: 240,
                            lineRule: 'auto',
                        });
                    }
                }
            }
        }

        // Modalidade e pré-requisito em campos próprios do cabeçalho de carga horária.
        if (studentWorkloadStart >= 0) {
            const teacherWorkloadStart = indexOfExact('CARGA HORÁRIA (docente/turma)');
            const workloadEnd = teacherWorkloadStart > studentWorkloadStart ? teacherWorkloadStart : texts.length;
            const modalityHeaderIndex = indexOfExact('MODALIDADE/ SUBMODALIDADE');
            const prereqHeaderIndex = indexOfExact('PRÉ-REQUISITO (POR CURSO)');
            const disciplinaIndex = indexOfExact('DISCIPLINA');

            const isModalityArtifactText = (normalizedText: string) => (
                normalizedText.includes('DISCIPLINA')
                && (normalizedText.includes('TEORIC') || normalizedText.includes('PRAT'))
            );
            const isWorkloadMarkerText = (normalizedText: string) => (
                /^(T|T\/P|P|PP|EXT|E|TOTAL|NAO SE APLICA|\d+)$/.test(normalizedText)
            );

            const isBoldParagraph = (paragraphXml: string) => /<w:pPr[\s\S]*?<w:rPr>[\s\S]*?<w:b\/>/.test(paragraphXml);

            const findModalityTarget = (start: number, end: number) => {
                if (start < 0 || end <= start) {
                    return -1;
                }

                const modalityArtifactCandidates: number[] = [];
                const genericValueCandidates: number[] = [];

                for (let index = start + 1; index < end; index += 1) {
                    const normalized = normalizeHeading(texts[index]);

                    if (!normalized || sectionHeaders.has(normalized) || isWorkloadMarkerText(normalized)) {
                        continue;
                    }

                    if (isModalityArtifactText(normalized)) {
                        modalityArtifactCandidates.push(index);
                        continue;
                    }

                    genericValueCandidates.push(index);
                }

                if (modalityArtifactCandidates.length > 0) {
                    const nonBoldCandidate = modalityArtifactCandidates.find(
                        (index) => !isBoldParagraph(updatedParagraphs[index])
                    );

                    return nonBoldCandidate ?? modalityArtifactCandidates[0];
                }

                if (genericValueCandidates.length > 0) {
                    const nonBoldCandidate = genericValueCandidates.find(
                        (index) => !isBoldParagraph(updatedParagraphs[index])
                    );

                    return nonBoldCandidate ?? genericValueCandidates[0];
                }

                return -1;
            };

            const clearDuplicateModalityArtifacts = (start: number, end: number, keepIndex: number) => {
                if (start < 0 || end <= start) {
                    return;
                }

                for (let index = start + 1; index < end; index += 1) {
                    if (index === keepIndex) {
                        continue;
                    }

                    const normalized = normalizeHeading(texts[index]);

                    if (isModalityArtifactText(normalized)) {
                        clearIndex(index);
                    }
                }
            };

            const findPrereqTarget = (start: number, end: number) => {
                if (start < 0 || end <= start) {
                    return -1;
                }

                for (let index = start + 1; index < end; index += 1) {
                    if (/^(n[aã]o\s+se\s+aplica|n\/a)$/i.test(texts[index])) {
                        return index;
                    }
                }

                for (let index = end - 1; index > start; index -= 1) {
                    if (!texts[index]) {
                        return index;
                    }
                }

                return -1;
            };

            let modalityValueIndex = findModalityTarget(
                modalityHeaderIndex,
                prereqHeaderIndex > 0 ? prereqHeaderIndex : workloadEnd
            );

            if (modalityValueIndex < 0 && prereqHeaderIndex > modalityHeaderIndex) {
                modalityValueIndex = findModalityTarget(
                    prereqHeaderIndex,
                    teacherWorkloadStart > prereqHeaderIndex ? teacherWorkloadStart : workloadEnd
                );
            }

            const prereqValueIndex = findPrereqTarget(
                prereqHeaderIndex,
                teacherWorkloadStart > prereqHeaderIndex ? teacherWorkloadStart : (disciplinaIndex > 0 ? disciplinaIndex : workloadEnd)
            );

            if (modalityValueIndex >= 0) {
                replaceIndex(modalityValueIndex, this.normalizeModalityForTemplate(data.modality));
                updatedParagraphs[modalityValueIndex] = this.applyParagraphAlignment(updatedParagraphs[modalityValueIndex], 'center');
                clearDuplicateModalityArtifacts(
                    modalityHeaderIndex,
                    prereqHeaderIndex > 0 ? prereqHeaderIndex : workloadEnd,
                    modalityValueIndex
                );
            }

            if (prereqValueIndex >= 0) {
                replaceIndex(prereqValueIndex, this.formatPrerequerimentsForTemplate(data.prerequeriments));
                updatedParagraphs[prereqValueIndex] = this.applyParagraphAlignment(updatedParagraphs[prereqValueIndex], 'center');
                updatedParagraphs[prereqValueIndex] = this.applyParagraphSpacing(updatedParagraphs[prereqValueIndex], {
                    before: 0,
                    after: 0,
                    line: 200,
                    lineRule: 'auto',
                });
            }
        }

        // Carga horária: preenche células por ordem de colunas T, T/P, P, PP, Ext, E, TOTAL.
        const toWorkloadNumber = (value?: number | null) => String(value ?? 0);
        const sumValues = (...values: Array<number | null | undefined>) => values.reduce<number>(
            (acc, current) => acc + (current ?? 0),
            0
        );

        const buildWorkloadVector = (workload?: {
            theory?: number | null;
            theoryPractice?: number | null;
            practice?: number | null;
            practiceInternship?: number | null;
            extension?: number | null;
            internship?: number | null;
        }, options?: { includeTotal?: boolean }) => {
            const theory = workload?.theory ?? 0;
            const theoryPractice = workload?.theoryPractice ?? 0;
            const practice = workload?.practice ?? 0;
            const practiceInternship = workload?.practiceInternship ?? 0;
            const internship = workload?.internship ?? 0;
            const extension = workload?.extension ?? 0;

            // Compatibilidade com cargas legadas consolidadas:
            // quando somente "theory" vier preenchido, tratamos como valor consolidado em E/TOTAL.
            const hasOnlyTheory = theory > 0
                && theoryPractice === 0
                && practice === 0
                && practiceInternship === 0
                && extension === 0
                && internship === 0;

            const normalizedTheory = hasOnlyTheory ? 0 : theory;
            const normalizedInternship = hasOnlyTheory ? theory : internship;
            const total = sumValues(
                normalizedTheory,
                theoryPractice,
                practice,
                practiceInternship,
                extension,
                normalizedInternship
            );

            const values = [
                toWorkloadNumber(normalizedTheory),
                toWorkloadNumber(theoryPractice),
                toWorkloadNumber(practice),
                toWorkloadNumber(practiceInternship),
                toWorkloadNumber(extension),
                toWorkloadNumber(normalizedInternship),
            ];

            if (options?.includeTotal !== false) {
                values.push(toWorkloadNumber(total));
            }

            return values;
        };

        if (studentWorkloadStart >= 0) {
            const teacherWorkloadStart = indexOfExact('CARGA HORÁRIA (docente/turma)');
            const textualSectionStart = indexOfExact('EMENTA');
            const workloadVisualEnd = textualSectionStart > studentWorkloadStart ? textualSectionStart : texts.length;
            for (let index = studentWorkloadStart; index < workloadVisualEnd; index += 1) {
                updatedParagraphs[index] = this.stripParagraphNumbering(updatedParagraphs[index]);
            }

            const isWorkloadCellCandidate = (text: string) => text === '' || /^\d+$/.test(text);

            const findNumericRunStart = (startIndex: number, endExclusive: number, size: number) => {
                for (let index = startIndex + 1; index <= endExclusive - size; index += 1) {
                    let matches = true;

                    for (let offset = 0; offset < size; offset += 1) {
                        if (!isWorkloadCellCandidate(texts[index + offset])) {
                            matches = false;
                            break;
                        }
                    }

                    if (matches) {
                        return index;
                    }
                }

                return -1;
            };

            const totalHeaderIndexes = texts
                .map((text, index) => ({ text, index }))
                .filter((item) => normalizeHeading(item.text) === 'TOTAL')
                .map((item) => item.index);

            const studentTotalHeaderIndex = totalHeaderIndexes[0] ?? -1;
            const teacherTotalHeaderIndex = totalHeaderIndexes[1] ?? -1;

            const firstStudentNumericIndex = findNumericRunStart(
                studentTotalHeaderIndex > 0 ? studentTotalHeaderIndex : studentWorkloadStart,
                teacherWorkloadStart > 0 ? teacherWorkloadStart : workloadVisualEnd,
                7
            );

            if (firstStudentNumericIndex > 0) {
                const studentValues = buildWorkloadVector(data.workload?.student);
                studentValues.forEach((value, offset) => {
                    const targetIndex = firstStudentNumericIndex + offset;
                    replaceIndex(targetIndex, value);
                    updatedParagraphs[targetIndex] = this.normalizeWorkloadCellParagraph(updatedParagraphs[targetIndex]);
                });

                const teacherNumericStart = findNumericRunStart(
                    teacherTotalHeaderIndex > 0 ? teacherTotalHeaderIndex : firstStudentNumericIndex + 6,
                    workloadVisualEnd,
                    7
                );

                const teacherValues = buildWorkloadVector(data.workload?.professor);
                teacherValues.forEach((value, offset) => {
                    const targetIndex = teacherNumericStart > 0 ? teacherNumericStart + offset : firstStudentNumericIndex + 34 + offset;
                    replaceIndex(targetIndex, value);
                    updatedParagraphs[targetIndex] = this.normalizeWorkloadCellParagraph(updatedParagraphs[targetIndex]);
                });

                const moduleNumericStart = findNumericRunStart(
                    teacherNumericStart > 0 ? teacherNumericStart + 7 : firstStudentNumericIndex + 41,
                    workloadVisualEnd,
                    6
                );

                const moduleValues = buildWorkloadVector(data.workload?.module, { includeTotal: false });
                moduleValues.forEach((value, offset) => {
                    const targetIndex = moduleNumericStart > 0 ? moduleNumericStart + offset : firstStudentNumericIndex + 41 + offset;
                    replaceIndex(targetIndex, value);
                    updatedParagraphs[targetIndex] = this.normalizeWorkloadCellParagraph(updatedParagraphs[targetIndex]);
                });

                // O bloco de módulo no template vigente tem 6 colunas (sem TOTAL).
                const moduleTrailingIndex = (moduleNumericStart > 0 ? moduleNumericStart : firstStudentNumericIndex + 41) + 6;
                if (moduleTrailingIndex < workloadVisualEnd) {
                    clearIndex(moduleTrailingIndex);
                }
            }
        }

        // Assinatura docente no mesmo local do template oficial.
        const approvedBy = this.normalizeSectionText(data.approval?.approvedBy, 'Não informado');
        const signatureLineIndex = texts.findIndex(
            (text) => /^Nome:\s*/.test(text) && /Assinatura:/.test(text) && !/Nome:\s*_+/.test(text)
        );
        if (signatureLineIndex >= 0) {
            if (signatureAsset) {
                updatedParagraphs[signatureLineIndex] = this.docxSignatureEmbedder.embedSignature(
                    zip,
                    updatedParagraphs[signatureLineIndex],
                    approvedBy,
                    signatureAsset
                );
                texts[signatureLineIndex] = `Nome: ${approvedBy} Assinatura: ____________________________________`;
            } else {
                replaceIndex(signatureLineIndex, `Nome: ${approvedBy} Assinatura: ____________________________________`);
            }
        }

        const chiefSignatureLineIndex = texts.findIndex(
            (text) => /^Nome:\s*_+/.test(text) && /Assinatura:/.test(text)
        );
        if (chiefSignatureLineIndex >= 0) {
            replaceIndex(chiefSignatureLineIndex, 'Nome: ___________________________________________ Assinatura: ____________________________________');
        }

        const facultyHeaderIndex = texts.findIndex((text) => text.startsWith('Docente(s) Responsável(is)'));
        if (facultyHeaderIndex >= 0) {
            updatedParagraphs[facultyHeaderIndex] = this.stripParagraphDrawings(updatedParagraphs[facultyHeaderIndex]);
        }

        // Seções textuais principais.
        replaceSectionContent('EMENTA', this.normalizeSectionText(data.syllabus));
        const normalizedObjectives = this.normalizeMultilineSectionText(data.objective, 'Não informado', {
            indentParagraphs: true,
        });
        replaceSectionContent('OBJETIVO GERAL', normalizedObjectives, {
            spacing: { before: 0, after: 20, line: 252, lineRule: 'auto' },
        });
        replaceSectionContent('OBJETIVOS ESPECÍFICOS', normalizedObjectives, {
            spacing: { before: 0, after: 20, line: 252, lineRule: 'auto' },
        });
        replaceSectionContent(
            'CONTEÚDO PROGRAMÁTICO',
            this.normalizeSectionText((data as unknown as { description?: string }).description || data.program),
            { preserveOnlyFirst: true }
        );
        replaceSectionContent('METODOLOGIA DE ENSINO-APRENDIZAGEM', this.normalizeSectionText(data.methodology));
        replaceSectionContent('AVALIAÇÃO DA APRENDIZAGEM', this.normalizeSectionText(data.learningAssessment));
        replaceSectionContent('REFERÊNCIAS BÁSICAS', referencesBasic, {
            spacing: { before: 60, after: 90, line: 276, lineRule: 'auto' },
            trailingSpacing: { before: 0, after: 20, line: 228, lineRule: 'auto' },
        });
        replaceSectionContent('REFERÊNCIAS COMPLEMENTARES', referencesComplementary, {
            spacing: { before: 40, after: 50, line: 228, lineRule: 'auto' },
            trailingSpacing: { before: 0, after: 20, line: 228, lineRule: 'auto' },
        });

        let cursor = 0;
        const nextDocumentXml = documentXml.replace(/<w:p[\s\S]*?<\/w:p>/g, () => {
            const nextParagraph = updatedParagraphs[cursor];
            cursor += 1;
            return nextParagraph;
        });

        zip.updateFile('word/document.xml', Buffer.from(nextDocumentXml, 'utf-8'));

        return zip.toBuffer();
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

    async getComponents(options?: {
        search?: string;
        showDraft?: boolean;
        sortBy?: string;
        sortOrder?: 'ASC' | 'DESC';
        academicLevel?: AcademicLevel;
        department?: string;
    }) {
        const search = this.normalizeSearch(options?.search);
        const normalizedDepartment = options?.department?.trim().toLowerCase();
        const sortMap: Record<string, string> = {
            code: 'components.code',
            name: 'components.name',
            department: 'COALESCE(departmentRef.name, components.department)',
            academicLevel: 'components.academicLevel',
            semester: 'components.semester',
            createdAt: 'components.createdAt',
            updatedAt: 'components.updatedAt',
        };
        const sortBy = sortMap[options?.sortBy ?? ''] ?? 'components.code';
        const sortOrder = options?.sortOrder ?? 'ASC';
        const allowedStatuses = [ ComponentStatus.PUBLISHED ];

        if (options?.showDraft) {
            allowedStatuses.push(ComponentStatus.DRAFT);
        }

        const query = this.componentRepository
            .createQueryBuilder('components')
            .leftJoinAndSelect('components.departmentRef', 'departmentRef')
            .leftJoinAndSelect('components.draft', 'draft')
            .leftJoinAndSelect('draft.departmentRef', 'draft_departmentRef')
            .leftJoinAndSelect('components.logs', 'logs')
            .leftJoinAndSelect('components.workload', 'workload')
            .leftJoinAndSelect('components.curriculumContexts', 'curriculumContexts')
            .leftJoinAndSelect('draft.workload', 'draft_workload')
            .leftJoinAndSelect('logs.user', 'logs_user')
            .where('components.status IN (:...allowedStatuses)', { allowedStatuses });

        if (search) {
            query.andWhere(new Brackets((subQuery) => {
                subQuery
                    .where(`${this.accentInsensitiveSql('components.code')} LIKE :search`, { search: `%${search}%` })
                    .orWhere(`${this.accentInsensitiveSql('components.name')} LIKE :search`, { search: `%${search}%` });
            }));
        }

        if (options?.academicLevel) {
            query.andWhere('components.academicLevel = :academicLevel', {
                academicLevel: options.academicLevel,
            });
        }

        if (normalizedDepartment) {
            const normalizedDepartmentColumn = this.accentInsensitiveSql('components.department');
            const normalizedDepartmentRefNameColumn = this.accentInsensitiveSql("COALESCE(departmentRef.name, '')");
            const normalizedDepartmentRefCodeColumn = this.accentInsensitiveSql("COALESCE(departmentRef.code, '')");

            if (this.isUuid(normalizedDepartment)) {
                query.andWhere('components.departmentId = :departmentId', {
                    departmentId: normalizedDepartment,
                });
            } else if (normalizedDepartment === '__dcc__') {
                query.andWhere(new Brackets((subQuery) => {
                    subQuery
                        .where(`${normalizedDepartmentColumn} LIKE :dccByName`, {
                            dccByName: '%ciencia da computacao%',
                        })
                        .orWhere(`${normalizedDepartmentColumn} LIKE :dccByAcronym`, {
                            dccByAcronym: '%dcc%',
                        })
                        .orWhere(`${normalizedDepartmentRefNameColumn} LIKE :dccByName`, {
                            dccByName: '%ciencia da computacao%',
                        })
                        .orWhere(`${normalizedDepartmentRefCodeColumn} LIKE :dccByAcronym`, {
                            dccByAcronym: '%dcc%',
                        });
                }));
            } else if (normalizedDepartment === '__dci__') {
                query.andWhere(new Brackets((subQuery) => {
                    subQuery
                        .where(`${normalizedDepartmentColumn} LIKE :dciByName`, {
                            dciByName: '%computacao interdisciplinar%',
                        })
                        .orWhere(`${normalizedDepartmentColumn} LIKE :dciByAcronym`, {
                            dciByAcronym: '%dci%',
                        })
                        .orWhere(`${normalizedDepartmentRefNameColumn} LIKE :dciByName`, {
                            dciByName: '%computacao interdisciplinar%',
                        })
                        .orWhere(`${normalizedDepartmentRefCodeColumn} LIKE :dciByAcronym`, {
                            dciByAcronym: '%dci%',
                        });
                }));
            } else {
                const courseAliases = getCourseFilterAliases(options?.department);

                query.andWhere(new Brackets((subQuery) => {
                    if (courseAliases.length > 0) {
                        subQuery
                            .where(`${normalizedDepartmentColumn} IN (:...courseAliases)`, { courseAliases })
                            .orWhere(`${normalizedDepartmentRefNameColumn} IN (:...courseAliases)`, { courseAliases })
                            .orWhere(`${normalizedDepartmentRefCodeColumn} IN (:...courseAliases)`, { courseAliases });
                    } else {
                        subQuery
                            .where(`${normalizedDepartmentColumn} = :department`, { department: normalizedDepartment })
                            .orWhere(`${normalizedDepartmentRefNameColumn} = :department`, { department: normalizedDepartment })
                            .orWhere(`${normalizedDepartmentRefCodeColumn} = :department`, { department: normalizedDepartment });
                    }
                }));
            }
        }

        const components = await query
            .orderBy(sortBy, sortOrder)
            .addOrderBy('logs.createdAt', 'DESC')
            .getMany();

        return components.map((component) => this.normalizeComponentCourseForDisplay(component));
    }

    async getComponentByCode(code: string) {
        const normalizedCode = code.trim().toLowerCase();

        const component = await this.componentRepository
            .createQueryBuilder('components')
            .leftJoinAndSelect('components.departmentRef', 'departmentRef')
            .leftJoinAndSelect('components.draft', 'draft')
            .leftJoinAndSelect('draft.departmentRef', 'draft_departmentRef')
            .leftJoinAndSelect('components.logs', 'logs')
            .leftJoinAndSelect('components.workload', 'workload')
            .leftJoinAndSelect('components.curriculumContexts', 'curriculumContexts')
            .leftJoinAndSelect('draft.workload', 'draft_workload')
            .leftJoinAndSelect('logs.user', 'logs_user')
            .where({
                code: Raw((alias) => `LOWER(${alias}) = :code`, {
                    code: normalizedCode,
                }),
            })
            .orderBy({
                'logs.createdAt': 'DESC',
            })
            .getOne();

        if (!component) throw new AppError('Component not found.', 404);

        return this.normalizeComponentCourseForDisplay(component);
    }

    async create(userId: string, requestDto: CreateComponentRequestDto) {
        const normalizedCode = requestDto.code.trim().toUpperCase();
        const componentExists = await this.componentRepository.findOne({
            where: { code: normalizedCode },
        });

        if (componentExists) {
            throw new AppError('Component already exists.', 400);
        }

        try {
            const componentDto = {
                ...requestDto,
                code: normalizedCode,
                prerequeriments: await this.normalizeAndValidatePrerequeriments(
                    requestDto.prerequeriments,
                    normalizedCode
                ),
                userId: userId,
            } as CreateComponentRequestDto & { userId: string; departmentId?: string | null; workloadId?: string };
            this.syncReferenceFields(componentDto);
            await this.departmentResolutionService.applyDepartment(componentDto);

            const [ componentWorkload, draftWorkload ] = await Promise.all(
                new Array(2)
                    .fill(null)
                    .map(() =>
                        this.workloadService.create(componentDto.workload ?? {})
                    )
            );

            delete componentDto.workload;
            componentDto.workloadId = componentWorkload.id;

            const component = this.componentRepository.create({
                status: ComponentStatus.PUBLISHED,
                ...componentDto,
            });
            const createdComponent = await this.componentRepository.save(
                component
            );

            const draft = this.componentDraftRepository.create({
                ...component,
                id: undefined,
                workloadId: draftWorkload.id,
                status: undefined,
                componentId: component.id,
            } as unknown as ComponentDraft);

            let componentLog = component.generateLog(
                userId,
                ComponentLogType.CREATION
            );
            componentLog = this.componentLogRepository.create(componentLog);

            await Promise.all([
                this.componentLogRepository.save(componentLog),
                this.componentDraftRepository.save(draft),
            ]);

            await this.componentRepository.save({
                id: component.id,
                draftId: draft.id,
            });
            component.draftId = draft.id;

            return createdComponent;
        } catch (err) {
            throw new AppError('An error has been occurred.', 400);
        }
    }

    async update(
        id: string,
        componentDto: UpdateComponentRequestDto,
        userId: string
    ) {
        const sanitizedComponentDto = this.sanitizeComponentUpdateDto(componentDto);
        const componentExists = await this.componentRepository.findOne({
            where: { id },
        });

        if (!componentExists) {
            throw new AppError('Component not found.', 404);
        }

        const nextCode = sanitizedComponentDto.code?.trim().toUpperCase();

        const codeComponent =
            nextCode && nextCode !== componentExists.code
                ? await this.componentRepository.findOne({
                    where: { code: nextCode },
                })
                : null;
        if (codeComponent) {
            throw new AppError('Invalid code', 400);
        }

        try {
            if (nextCode) {
                sanitizedComponentDto.code = nextCode;
            }

            if (sanitizedComponentDto.prerequeriments !== undefined) {
                sanitizedComponentDto.prerequeriments = await this.normalizeAndValidatePrerequeriments(
                    sanitizedComponentDto.prerequeriments,
                    nextCode ?? componentExists.code
                );
            }

            this.syncReferenceFields(sanitizedComponentDto);
            await this.departmentResolutionService.applyDepartment(sanitizedComponentDto);

            if (sanitizedComponentDto.workload != null) {
                const workloadData = {
                    ...sanitizedComponentDto.workload,
                    id:
                        sanitizedComponentDto.workloadId ??
                        (componentExists.workloadId as string),
                };

                const workload = await this.workloadService.upsert(
                    workloadData
                );
                sanitizedComponentDto.workloadId = workload?.id;
                delete sanitizedComponentDto.workload;
            }

            await this.componentRepository
                .createQueryBuilder()
                .update(Component)
                .set(sanitizedComponentDto)
                .where('id = :id', { id })
                .execute();

            let componentLog = componentExists.generateLog(
                userId,
                ComponentLogType.UPDATE
            );
            componentLog = this.componentLogRepository.create(componentLog);
            await this.componentLogRepository.save(componentLog);

            return await this.componentRepository.findOne({
                where: { id },
            });
        } catch (err) {
            throw new AppError('An error has been occurred.', 400);
        }
    }

    async delete(id: string) {
        const [ componentExists, draft ] = await Promise.all([
            this.componentRepository.findOne({
                where: { id },
            }),
            this.componentDraftRepository.findOne({
                componentId: id,
            }),
        ]);

        if (!componentExists) {
            throw new AppError('Component not found.', 404);
        }

        await this.componentRepository.save({
            ...componentExists,
            draftId: null,
        });

        // Remove any log rows linked to the published component and/or its draft
        // before deleting the draft row to satisfy FK constraints.
        await this.componentLogRepository.delete({
            componentId: id,
        });

        if (draft?.id) {
            await this.componentLogRepository.delete({
                draftId: draft.id,
            });

            await this.componentDraftRepository.delete({
                id: draft.id,
            });
        }

        await this.componentRepository
            .createQueryBuilder()
            .delete()
            .from(Component)
            .where('id = :id', { id })
            .execute();

        if (componentExists.workloadId != null) {
            await Promise.all([
                this.workloadService.delete(componentExists.workloadId),
                this.workloadService.delete(draft?.workloadId as string),
            ]);
        }
    }

    async export(id: string, format: 'pdf' | 'doc' | 'docx' = 'pdf') {
        const component = await this.componentRepository
            .createQueryBuilder('components')
            .leftJoinAndSelect('components.workload', 'workload')
            .leftJoinAndSelect('components.logs', 'logs')
            .leftJoinAndSelect('logs.user', 'logs_user')
            .where({ id })
            .getOne();

        if (!component) {
            throw new AppError('Component not found.', 404);
        }

        const { workload, logs } = component;
        const latestApprovalLog = logs
            ?.filter((log) => log.type === ComponentLogType.APPROVAL)
            .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];

        const data: GenerateHtmlData = {
            ...component,
            approval: latestApprovalLog
                ? {
                    agreementNumber: latestApprovalLog.agreementNumber,
                    agreementDate: latestApprovalLog.agreementDate,
                    approvedBy: latestApprovalLog.user?.name,
                }
                : undefined,
            workload: workload
                ? {
                    student: {
                        theory: workload.studentTheory,
                        practice: workload.studentPractice,
                        theoryPractice: workload.studentTheoryPractice,
                        internship: workload.studentInternship,
                        extension: workload.studentExtension,
                        practiceInternship:
                              workload.studentPracticeInternship,
                    },
                    professor: {
                        theory: workload.teacherTheory,
                        practice: workload.teacherPractice,
                        theoryPractice: workload.teacherTheoryPractice,
                        internship: workload.teacherInternship,
                        extension: workload.teacherExtension,
                        practiceInternship:
                              workload.teacherPracticeInternship,
                    },
                    module: {
                        theory: workload.moduleTheory,
                        practice: workload.modulePractice,
                        theoryPractice: workload.moduleTheoryPractice,
                        internship: workload.moduleInternship,
                        extension: workload.moduleExtension,
                        practiceInternship: workload.modulePracticeInternship,
                    },
                }
                : undefined,
            exportMode: format === 'pdf' ? 'pdf' : 'docx',
        };

        const signatureAsset = await this.signatureAssetService.loadForDocument(latestApprovalLog?.user);
        const templateDocx = this.fillDocxTemplateFromBase(data, signatureAsset);

        if (format === 'doc' || format === 'docx') {
            return {
                buffer: templateDocx,
                contentType:
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                fileName: `${component.code}.docx`,
            };
        }

        const convertedPdf = this.pdfConverter.convert({
            docxBuffer: templateDocx,
            fileBaseName: component.code,
        });

        if (convertedPdf) {
            return {
                buffer: convertedPdf,
                contentType: 'application/pdf',
                fileName: `${component.code}.pdf`,
            };
        }

        throw new AppError(
            'Nao foi possivel converter DOCX oficial para PDF. Instale o LibreOffice no ambiente para manter fidelidade total ao template Word.',
            500
        );
    }
}
