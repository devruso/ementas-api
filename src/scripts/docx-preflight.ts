import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import AdmZip from 'adm-zip';

type PreflightResult = {
  file: string;
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; details?: string; required: boolean }>;
};

const ensureDocxCandidates = (args: string[]) => {
    const provided = args
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => path.resolve(process.cwd(), item));

    if (provided.length > 0) {
        return provided;
    }

    const candidateDirs = [
        path.resolve(process.cwd(), 'tmp', 'docx-validation'),
        path.resolve(process.cwd(), 'tmp'),
    ];

    for (const candidateDir of candidateDirs) {
        if (!fs.existsSync(candidateDir)) {
            continue;
        }

        const files = fs.readdirSync(candidateDir)
            .filter((name) => /\.docx$/i.test(name))
            .sort((a, b) => a.localeCompare(b))
            .slice(0, 10)
            .map((name) => path.join(candidateDir, name));

        if (files.length > 0) {
            return files;
        }
    }

    return [];
};

const decodeXmlText = (value: string) => value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&');

const getParagraphText = (paragraphXml: string) => Array.from(
    paragraphXml.matchAll(/<w:t(?=[\s>])[^>]*>([\s\S]*?)<\/w:t>/g),
)
    .map((item) => decodeXmlText(item[1]))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

const getNodeText = (nodeXml: string) => Array.from(
    nodeXml.matchAll(/<w:t(?=[\s>])[^>]*>([\s\S]*?)<\/w:t>/g),
)
    .map((item) => decodeXmlText(item[1]))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

const getRows = (tableXml: string) => Array.from(
    tableXml.matchAll(/<w:tr(?=[\s>])[\s\S]*?<\/w:tr>/g),
).map((item) => item[0]);

const getCells = (rowXml: string) => Array.from(
    rowXml.matchAll(/<w:tc(?=[\s>])[\s\S]*?<\/w:tc>/g),
).map((item) => item[0]);

const normalizeText = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

const findWorkloadTable = (documentXml: string, heading: string) => Array.from(
    documentXml.matchAll(/<w:tbl(?=[\s>])[\s\S]*?<\/w:tbl>/g),
)
    .map((item) => item[0])
    .find((table) => normalizeText(getNodeText(table)).includes(normalizeText(heading)));

const validateWorkloadTable = (
    tableXml: string | undefined,
    moduleTable: boolean,
) => {
    if (!tableXml) {
        return { ok: false, details: 'Tabela de carga horaria nao encontrada.' };
    }

    const rows = getRows(tableXml);
    const headerCells = getCells(rows[1] || '');
    const valueCells = getCells(rows[2] || '');
    const requiredIndexes = moduleTable
        ? [ 0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13 ]
        : [ 0, 1, 2, 3, 4, 5, 6 ];
    const hasFixedLayout = /<w:tblLayout\s+w:type="fixed"\s*\/>/.test(tableXml);
    const rowsDoNotSplit = [ rows[1], rows[2] ].every((row) => !!row && /<w:cantSplit\s*\/>/.test(row));
    const cellsDoNotWrap = requiredIndexes.every((index) => (
        !!headerCells[index]
    && !!valueCells[index]
    && /<w:noWrap\s*\/>/.test(headerCells[index])
    && /<w:noWrap\s*\/>/.test(valueCells[index])
    ));
    const valuesAreNumeric = requiredIndexes.every((index) => /^\d+$/.test(getNodeText(valueCells[index] || '')));
    const spacersAreEmpty = !moduleTable || (
        getNodeText(headerCells[14] || '') === ''
    && getNodeText(headerCells[15] || '') === ''
    && getNodeText(valueCells[7] || '') === ''
    && getNodeText(valueCells[14] || '') === ''
    );
    const ok = hasFixedLayout && rowsDoNotSplit && cellsDoNotWrap && valuesAreNumeric && spacersAreEmpty;

    return {
        ok,
        details: ok
            ? undefined
            : `fixed=${hasFixedLayout}; cantSplit=${rowsDoNotSplit}; noWrap=${cellsDoNotWrap}; numeric=${valuesAreNumeric}; spacers=${spacersAreEmpty}`,
    };
};

const checkDocx = async (filePath: string): Promise<PreflightResult> => {
    const checks: PreflightResult['checks'] = [];
    let documentXml = '';

    const fileExists = fs.existsSync(filePath);
    checks.push({
        name: 'file-exists',
        ok: fileExists,
        required: true,
        details: fileExists ? undefined : 'Arquivo nao encontrado.',
    });

    if (!fileExists) {
        return { file: filePath, ok: false, checks };
    }

    const buffer = fs.readFileSync(filePath);
    const zipHeader = buffer.subarray(0, 2).toString('utf8') === 'PK';
    checks.push({
        name: 'zip-header',
        ok: zipHeader,
        required: true,
        details: zipHeader ? undefined : 'Cabecalho diferente de PK.',
    });

    if (!zipHeader) {
        return { file: filePath, ok: false, checks };
    }

    const zip = new AdmZip(buffer);
    const hasDocumentXml = zip.getEntry('word/document.xml') != null;
    checks.push({
        name: 'has-word-document-xml',
        ok: hasDocumentXml,
        required: true,
        details: hasDocumentXml ? undefined : 'word/document.xml ausente.',
    });

    if (!hasDocumentXml) {
        return { file: filePath, ok: false, checks };
    }

    documentXml = zip.readAsText('word/document.xml');

    // XML 1.0 forbids these control code points.
    // eslint-disable-next-line no-control-regex
    const invalidControlChars = documentXml.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) ?? [];
    checks.push({
        name: 'xml-invalid-control-chars',
        ok: invalidControlChars.length === 0,
        required: true,
        details: invalidControlChars.length === 0 ? undefined : `Encontrados ${invalidControlChars.length} caracteres invalidos.`,
    });

    const invalidTabsPayload = /<w:tabs>[^<]/.test(documentXml);
    checks.push({
        name: 'xml-invalid-tabs-payload',
        ok: !invalidTabsPayload,
        required: true,
        details: !invalidTabsPayload ? undefined : 'Encontrado payload invalido em w:tabs.',
    });

    const studentWorkload = validateWorkloadTable(
        findWorkloadTable(documentXml, 'CARGA HORARIA (estudante)'),
        false,
    );
    const teacherWorkload = validateWorkloadTable(
        findWorkloadTable(documentXml, 'CARGA HORARIA (docente/turma)'),
        true,
    );
    checks.push({
        name: 'student-workload-table-layout',
        ok: studentWorkload.ok,
        required: true,
        details: studentWorkload.details,
    });
    checks.push({
        name: 'teacher-module-workload-table-layout',
        ok: teacherWorkload.ok,
        required: true,
        details: teacherWorkload.details,
    });

    const paragraphs = Array.from(documentXml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)).map((item) => item[0]);
    const facultySignatureParagraph = paragraphs.find((paragraph) => /Docente\(s\) Respons[aá]vel\(is\)/i.test(getParagraphText(paragraph)));
    const hasFacultyDrawing = /<w:drawing|<w:pict/.test(facultySignatureParagraph || '');
    checks.push({
        name: 'no-drawing-in-faculty-signature-paragraph',
        ok: !!facultySignatureParagraph && !hasFacultyDrawing,
        required: true,
        details: !facultySignatureParagraph
            ? 'Paragrafo institucional de assinatura docente nao encontrado.'
            : (!hasFacultyDrawing ? undefined : 'Paragrafo de assinatura docente possui drawing/pict.'),
    });

    const teacherSignatureIndex = paragraphs.findIndex((paragraph) => {
        const text = getParagraphText(paragraph);

        return /^Nome:\s+/i.test(text) && /Assinatura:/i.test(text) && !/^Nome:\s*_+/i.test(text);
    });
    const teacherSignatureParagraph = teacherSignatureIndex >= 0 ? paragraphs[teacherSignatureIndex] : undefined;
    const teacherSignatureImageParagraph = teacherSignatureIndex > 0 ? paragraphs[teacherSignatureIndex - 1] : undefined;
    const teacherSignatureText = getParagraphText(teacherSignatureParagraph || '');
    const hasTeacherSignatureDrawing = /<w:drawing|<w:pict/.test(teacherSignatureImageParagraph || '');
    checks.push({
        name: 'teacher-signature-line-rendered',
        ok: !!teacherSignatureParagraph && (hasTeacherSignatureDrawing || /Assinatura:\s*_+/i.test(teacherSignatureText)),
        required: true,
        details: !teacherSignatureParagraph
            ? 'Linha de assinatura docente nao encontrada.'
            : (hasTeacherSignatureDrawing || /Assinatura:\s*_+/i.test(teacherSignatureText)
                ? undefined
                : 'Linha de assinatura docente sem imagem inline nem placeholder textual.'),
    });

    const drawingExtent = teacherSignatureImageParagraph?.match(/<wp:extent\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/);
    const drawingWidth = Number(drawingExtent?.[1] || 0);
    const drawingHeight = Number(drawingExtent?.[2] || 0);
    const signatureImageIsValid = !hasTeacherSignatureDrawing || (
        !!drawingExtent
    && drawingWidth <= 210 * 9525
    && drawingHeight <= 58 * 9525
    && /<w:jc\s+w:val="right"\s*\/>/.test(teacherSignatureImageParagraph || '')
    && /<w:keepNext\s*\/>/.test(teacherSignatureImageParagraph || '')
    );
    checks.push({
        name: 'teacher-signature-image-position-and-size',
        ok: signatureImageIsValid,
        required: true,
        details: signatureImageIsValid
            ? undefined
            : `Assinatura deve estar no paragrafo anterior a linha, alinhada a direita e limitada a 210x58 px. extent=${drawingWidth}x${drawingHeight}`,
    });

    const hasChiefSignatureLine = paragraphs
        .map((paragraph) => getParagraphText(paragraph))
        .some((text) => /^Nome:\s*_+\s*Assinatura:\s*_+/.test(text));
    checks.push({
        name: 'chief-signature-line-present',
        ok: hasChiefSignatureLine,
        required: true,
        details: hasChiefSignatureLine ? undefined : 'Linha de assinatura do chefe nao encontrada.',
    });

    try {
        const mammothResult = await mammoth.extractRawText({ buffer });
        const mammothOk = typeof mammothResult.value === 'string' && mammothResult.value.length > 0;
        checks.push({
            name: 'mammoth-readable',
            ok: mammothOk,
            required: false,
            details: mammothOk ? undefined : 'Mammoth nao conseguiu extrair texto.',
        });
    } catch (error) {
        checks.push({
            name: 'mammoth-readable',
            ok: false,
            required: false,
            details: `Mammoth indisponivel/limitado para este DOCX: ${String(error)}`,
        });
    }

    const ok = checks.filter((item) => item.required).every((item) => item.ok);

    return {
        file: filePath,
        ok,
        checks,
    };
};

const printResult = (result: PreflightResult) => {
    console.log(`\n[docx-preflight] ${result.file}`);

    result.checks.forEach((check) => {
        const status = check.ok ? 'OK' : (check.required ? 'FAIL' : 'WARN');
        const suffix = check.details ? ` - ${check.details}` : '';
        console.log(`  - ${status} ${check.name}${suffix}`);
    });
};

const main = async () => {
    const args = process.argv.slice(2);
    const files = ensureDocxCandidates(args);

    if (files.length === 0) {
        console.error('[docx-preflight] Nenhum arquivo .docx informado ou encontrado em tmp/.');
        process.exit(1);
    }

    const results: PreflightResult[] = [];

    for (const file of files) {
        const result = await checkDocx(file);
        results.push(result);
        printResult(result);
    }

    const failed = results.filter((item) => !item.ok);

    console.log(`\n[docx-preflight] Resumo: ${results.length - failed.length}/${results.length} arquivo(s) aprovados.`);

    if (failed.length > 0) {
        process.exit(1);
    }
};

main().catch((error) => {
    console.error('[docx-preflight] erro inesperado:', error);
    process.exit(1);
});
