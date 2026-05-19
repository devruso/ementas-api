import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';

const AdmZip = require('adm-zip');

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

  const tmpDir = path.resolve(process.cwd(), 'tmp');

  if (!fs.existsSync(tmpDir)) {
    return [];
  }

  return fs.readdirSync(tmpDir)
    .filter((name) => /\.docx$/i.test(name))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 10)
    .map((name) => path.join(tmpDir, name));
};

const decodeXmlText = (value: string) => value
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

const getParagraphText = (paragraphXml: string) => Array.from(
  paragraphXml.matchAll(/<w:t(?=[\s>])[^>]*>([\s\S]*?)<\/w:t>/g),
)
  .map((item) => decodeXmlText(item[1]))
  .join('')
  .replace(/\s+/g, ' ')
  .trim();

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

  const teacherSignatureParagraph = paragraphs.find((paragraph) => {
    const text = getParagraphText(paragraph);

    return /^Nome:\s+/i.test(text) && /Assinatura:/i.test(text) && !/^Nome:\s*_+/i.test(text);
  });
  const teacherSignatureText = getParagraphText(teacherSignatureParagraph || '');
  const hasTeacherSignatureDrawing = /<w:drawing|<w:pict/.test(teacherSignatureParagraph || '');
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
