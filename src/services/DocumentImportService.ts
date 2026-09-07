import mammoth from 'mammoth';
import * as cheerio from 'cheerio';
import { createRequire } from 'module';

import { AppError } from '../errors/AppError';
import {
    ImportDraftPreviewPayload,
    ImportDraftPreviewResponseDto,
} from '../dtos/component/draft/ImportDraftPreviewResponse';
import { splitBibliographySections } from '../helpers/referenceSections';

type ParsedDocument = {
    rawText: string;
    html?: string;
};

const SECTION_LABELS: Record<string, string[]> = {
    syllabus: [ 'EMENTA' ],
    objective: [ 'OBJETIVOS', 'OBJETIVO GERAL', 'OBJETIVOS ESPECÍFICOS' ],
    program: [ 'CONTEÚDO PROGRAMÁTICO' ],
    methodology: [ 'METODOLOGIA DE ENSINO-APRENDIZAGEM', 'METODOLOGIA' ],
    learningAssessment: [ 'AVALIAÇÃO DA APRENDIZAGEM' ],
    bibliography: [ 'REFERÊNCIAS', 'REFERÊNCIAS BÁSICAS', 'REFERÊNCIAS COMPLEMENTARES' ],
};

const HEADING_CANDIDATES = new Set(
    Object.values(SECTION_LABELS).flat().concat([
        'DADOS DE IDENTIFICAÇÃO E ATRIBUTOS',
        'CARGA HORÁRIA (ESTUDANTE)',
        'CARGA HORÁRIA (DOCENTE/TURMA)',
        'MÓDULO',
        'SEMESTRE DE INÍCIO DA VIGÊNCIA',
        'MODALIDADE/ SUBMODALIDADE',
        'PRÉ-REQUISITO (POR CURSO)',
        'DOCENTE(S) RESPONSÁVEL(IS) À ÉPOCA DA APROVAÇÃO DO PLANO DE ENSINO-APRENDIZAGEM:',
        'APROVADO EM REUNIÃO DE DEPARTAMENTO (OU EQUIVALENTE)',
    ])
);

const cleanText = (value: string) =>
    value
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

const normalizeLine = (value: string) => cleanText(value).toUpperCase();

const normalizeParagraphText = (value: string) =>
    value
        .split(/\r?\n/)
        .map(cleanText)
        .filter(Boolean)
        .map((line) => line.replace(/^((\d+[.)-]?)|([A-Za-z][.)])|[-*•])\s+/u, ''))
        .join(' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

const nodeRequire = createRequire(__filename);

const parseSemesterValue = (value: string) => {
    const semesterMatch = value.match(/SEMESTRE\s*(\d{4})\s*\.?\s*(\d)/i);

    if (!semesterMatch) {
        return '';
    }

    return `${semesterMatch[1]}.${semesterMatch[2]}`;
};

const buildEmptyPayload = (): ImportDraftPreviewPayload => ({
    code: '',
    name: '',
    department: '',
    modality: '',
    program: '',
    semester: '',
    prerequeriments: '',
    methodology: '',
    objective: '',
    syllabus: '',
    learningAssessment: '',
    bibliography: '',
    referencesBasic: '',
    referencesComplementary: '',
    workload: {},
});

export class DocumentImportService {
    private readonly maxFileSizeInBytes = 10 * 1024 * 1024;

    validateUploadedFile(file?: Express.Multer.File) {
        if (!file) {
            throw new AppError('Nenhum arquivo foi enviado para importação.', 400);
        }

        if (file.size > this.maxFileSizeInBytes) {
            throw new AppError('O arquivo excede o limite de 10MB para importação.', 400);
        }

        const supportedTypes = new Set([
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ]);

        if (!supportedTypes.has(file.mimetype)) {
            throw new AppError('Formato de arquivo não suportado. Envie um PDF ou DOCX.', 400);
        }
    }

    async generatePreview(file: Express.Multer.File): Promise<ImportDraftPreviewResponseDto> {
        this.validateUploadedFile(file);

        const parsedDocument = await this.parseDocument(file);
        const warnings: string[] = [];
        const extractedSections = this.extractSections(parsedDocument.rawText);
        const suggestedDraft = buildEmptyPayload();

        suggestedDraft.code = this.extractCode(parsedDocument.rawText);
        suggestedDraft.name = this.extractName(parsedDocument.rawText);
        suggestedDraft.department = this.extractDepartment(parsedDocument.rawText);
        suggestedDraft.modality = this.extractModality(parsedDocument.rawText);
        suggestedDraft.prerequeriments = this.extractPrerequeriments(parsedDocument.rawText);
        suggestedDraft.semester = this.extractSemester(parsedDocument.rawText);
        suggestedDraft.syllabus = extractedSections.syllabus ?? '';
        suggestedDraft.objective = extractedSections.objective ?? '';
        suggestedDraft.program = extractedSections.program ?? '';
        suggestedDraft.methodology = extractedSections.methodology ?? '';
        suggestedDraft.learningAssessment = extractedSections.learningAssessment ?? '';
        suggestedDraft.bibliography = extractedSections.bibliography ?? '';
        const referenceSections = splitBibliographySections(suggestedDraft.bibliography);
        suggestedDraft.referencesBasic = referenceSections.basic;
        suggestedDraft.referencesComplementary = referenceSections.complementary;

        suggestedDraft.workload = parsedDocument.html
            ? this.extractWorkloadFromHtml(parsedDocument.html, warnings)
            : this.extractWorkloadFromText(parsedDocument.rawText, warnings);

        if (!suggestedDraft.code) {
            warnings.push('Não foi possível identificar o código do componente com segurança.');
        }
        if (!suggestedDraft.name) {
            warnings.push('Não foi possível identificar o nome do componente com segurança.');
        }
        if (!suggestedDraft.department) {
            warnings.push('Não foi possível identificar o departamento com segurança.');
        }
        if (!suggestedDraft.semester) {
            warnings.push('Não foi possível identificar o semestre de vigência com segurança.');
        }

        const unrecognizedSections = Object.entries(SECTION_LABELS)
            .filter(([ key ]) => !suggestedDraft[key as keyof ImportDraftPreviewPayload])
            .map(([, labels]) => labels[0]);

        return {
            fileName: file.originalname,
            mimeType: file.mimetype,
            suggestedDraft,
            warnings: Array.from(new Set(warnings)),
            unrecognizedSections,
            extractedSections,
            rawText: parsedDocument.rawText,
        };
    }

    private async parseDocument(file: Express.Multer.File): Promise<ParsedDocument> {
        if (file.mimetype === 'application/pdf') {
            const pdfParse = nodeRequire('pdf-parse') as (data: Buffer) => Promise<{ text: string }>;
            const pdf = await pdfParse(file.buffer);
            return { rawText: cleanText(pdf.text) };
        }

        const [ htmlResult, rawTextResult ] = await Promise.all([
            mammoth.convertToHtml({ buffer: file.buffer }),
            mammoth.extractRawText({ buffer: file.buffer }),
        ]);

        return {
            rawText: cleanText(rawTextResult.value),
            html: htmlResult.value,
        };
    }

    private extractCode(rawText: string) {
        return rawText.match(/\b[A-Z]{2,4}\d{2,4}\b/)?.[0] ?? '';
    }

    private extractName(rawText: string) {
        const lines = rawText.split(/\r?\n/).map(cleanText).filter(Boolean);
        const code = this.extractCode(rawText);
        const codeIndex = lines.findIndex((line) => line === code);

        return codeIndex >= 0 ? lines[codeIndex + 1] ?? '' : '';
    }

    private extractDepartment(rawText: string) {
        const lines = rawText.split(/\r?\n/).map(cleanText).filter(Boolean);
        const code = this.extractCode(rawText);
        const codeIndex = lines.findIndex((line) => line === code);

        return codeIndex >= 0 ? lines[codeIndex + 2] ?? '' : '';
    }

    private extractModality(rawText: string) {
        const match = rawText.match(/MODALIDADE\/? SUBMODALIDADE\s*([\s\S]*?)\s*PRÉ-REQUISITO \(POR CURSO\)/i);

        return cleanText(match?.[1] ?? '');
    }

    private extractPrerequeriments(rawText: string) {
        const match = rawText.match(
            /PR[ÉE]-?REQUISITO \(POR CURSO\)\s*([\s\S]*?)(?:\s*CARGA HOR[ÁA]RIA \(ESTUDANTE\)|\s*CARGA HOR[ÁA]RIA \(DOCENTE\/TURMA\)|\s*SEMESTRE DE IN[IÍ]CIO DA VIG[ÊE]NCIA|\s*EMENTA)/i
        );

        const prerequerimentsBlock = cleanText(match?.[1] ?? '');

        if (!prerequerimentsBlock) {
            return '';
        }

        if (/n[aã]o\s+se\s+aplica/i.test(prerequerimentsBlock)) {
            return '';
        }

        const disciplineCodes = Array.from(
            new Set(prerequerimentsBlock.match(/\b[A-Z]{2,4}\d{2,4}\b/g) ?? [])
        );

        if (disciplineCodes.length > 0) {
            return disciplineCodes.join(', ');
        }

        return prerequerimentsBlock
            .replace(/Disciplina\s*Te[oó]rico\/Pr[aá]tica/gi, '')
            .replace(/\bT\b|\bT\/P\b|\bP\b|\bPP\b|\bEXT\b|\bE\b|\bTOTAL\b/gi, '')
            .replace(/[;|]+/g, ', ')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    private extractSemester(rawText: string) {
        const specificBlock = rawText.match(/SEMESTRE DE\s*INÍCIO DA VIGÊNCIA\s*([\s\S]*?)\s*EMENTA/i);

        if (specificBlock?.[1]) {
            const parsed = parseSemesterValue(specificBlock[1]);

            if (parsed) {
                return parsed;
            }
        }

        return parseSemesterValue(rawText);
    }

    private extractSections(rawText: string) {
        const lines = rawText.split(/\r?\n/).map(cleanText).filter(Boolean);
        const sections: Record<string, string> = {};

        Object.entries(SECTION_LABELS).forEach(([ key, labels ]) => {
            const indexes = labels
                .map((label) => lines.findIndex((line) => normalizeLine(line) === label))
                .filter((index) => index >= 0)
                .sort((left, right) => left - right);

            if (indexes.length === 0) {
                return;
            }

            const start = indexes[0] + 1;
            let end = lines.length;

            for (let index = start; index < lines.length; index += 1) {
                if (HEADING_CANDIDATES.has(normalizeLine(lines[index]))) {
                    end = index;
                    break;
                }
            }

            const content = lines.slice(start, end).join('\n');
            if (content) {
                sections[key] = key === 'syllabus' ? normalizeParagraphText(content) : content;
            }
        });

        return sections;
    }

    private extractWorkloadFromHtml(html: string, warnings: string[]) {
        const $ = cheerio.load(html);
        const tables = $('table').toArray();
        const values = buildEmptyPayload().workload;

        if (tables.length < 3) {
            warnings.push('Não foi possível extrair as tabelas de carga horária com segurança.');
            return values;
        }

        const mapRow = (tableIndex: number, prefix: 'student' | 'teacher' | 'module') => {
            const rows = $(tables[tableIndex]).find('tr').toArray();
            if (rows.length < 2) {
                return;
            }

            const cells = $(rows[1]).find('td').toArray().map((cell) => cleanText($(cell).text()));
            const numbers = cells.map((cell) => Number.parseInt(cell.replace(/[^0-9]/g, ''), 10) || 0);

            values[`${prefix}Theory` as keyof typeof values] = numbers[0] ?? 0;
            values[`${prefix}TheoryPractice` as keyof typeof values] = numbers[1] ?? 0;
            values[`${prefix}Practice` as keyof typeof values] = numbers[2] ?? 0;
            values[`${prefix}PracticeInternship` as keyof typeof values] = numbers[3] ?? 0;
            values[`${prefix}Extension` as keyof typeof values] = numbers[4] ?? 0;
            values[`${prefix}Internship` as keyof typeof values] = numbers[5] ?? numbers[4] ?? 0;
        };

        mapRow(0, 'student');
        mapRow(1, 'teacher');
        mapRow(2, 'module');

        return values;
    }

    private extractWorkloadFromText(rawText: string, warnings: string[]) {
        const values = buildEmptyPayload().workload;
        const block = rawText.match(/CARGA HORÁRIA \(ESTUDANTE\)([\s\S]*?)EMENTA/i)?.[1] ?? '';
        const numericTokens = block.match(/\b\d+\b/g)?.map((token) => Number.parseInt(token, 10)) ?? [];

        if (numericTokens.length < 3) {
            warnings.push('Não foi possível inferir a carga horária a partir do texto extraído com segurança.');
            return values;
        }

        values.studentTheory = numericTokens[0] ?? 0;
        values.studentPractice = numericTokens[1] ?? 0;
        values.teacherTheory = numericTokens[2] ?? 0;
        values.teacherPractice = numericTokens[3] ?? 0;
        values.moduleTheory = numericTokens[4] ?? 0;

        return values;
    }
}
