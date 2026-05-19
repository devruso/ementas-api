import fs from 'fs';
import path from 'path';

import { ComponentService } from '../services/ComponentService';
import { ComponentStatus } from '../interfaces/ComponentStatus';
import type { GenerateHtmlData } from '../helpers/templates/component';

const outputDir = path.resolve(process.cwd(), 'tmp', 'docx-validation');

const ensureDir = () => {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
};

const createServiceWithoutDb = () => Object.create(ComponentService.prototype) as ComponentService;

const buildCommon = (): Omit<GenerateHtmlData, 'id' | 'code' | 'name' | 'program' | 'objective' | 'syllabus' | 'methodology' | 'learningAssessment' | 'referencesBasic' | 'referencesComplementary'> => ({
  userId: 'validation-user',
  status: ComponentStatus.PUBLISHED,
  department: 'Departamento de Ciencia da Computacao',
  modality: 'DISCIPLINA',
  semester: '2026.1',
  prerequeriments: 'IC001',
  bibliography: '',
  workload: {
    student: {
      theory: 34,
      theoryPractice: 0,
      practice: 17,
      practiceInternship: 0,
      internship: 0,
    },
    professor: {
      theory: 34,
      theoryPractice: 0,
      practice: 17,
      practiceInternship: 0,
      internship: 0,
    },
    module: {
      theory: 34,
      theoryPractice: 0,
      practice: 17,
      practiceInternship: 0,
      internship: 0,
    },
  },
  approval: {
    agreementNumber: 'ATA-2026-001',
    agreementDate: new Date('2026-05-05T12:30:00.000Z'),
    approvedBy: 'Prof. Validacao EMENTAS',
  },
});

const samples: Array<{ fileName: string; data: GenerateHtmlData }> = [
  {
    fileName: 'docx-curta-IC900.docx',
    data: {
      ...buildCommon(),
      id: 'sample-short',
      code: 'IC900',
      name: 'Topicos Especiais Curta',
      program: 'Fundamentos introdutorios da disciplina.',
      objective: 'Compreender os fundamentos da disciplina.',
      syllabus: 'Introducao aos conceitos basicos.',
      methodology: 'Aulas expositivas e atividades dirigidas.',
      learningAssessment: 'Exercicios semanais e prova final.',
      referencesBasic: 'SILVA, Joao. Fundamentos de Computacao. 2021.',
      referencesComplementary: 'Portal CAPES https://www-periodicos-capes-gov-br.ezl.periodicos.capes.gov.br',
    },
  },
  {
    fileName: 'docx-media-IC901.docx',
    data: {
      ...buildCommon(),
      id: 'sample-medium',
      code: 'IC901',
      name: 'Topicos Especiais Media',
      program: [
        'Unidade 1: introducao e contexto institucional.',
        'Unidade 2: fundamentos tecnicos e modelagem.',
        'Unidade 3: laboratorio pratico com estudos de caso.',
      ].join('\n'),
      objective: [
        'Desenvolver capacidade de analise critica.',
        'Aplicar tecnicas de modelagem em cenarios reais.',
        'Produzir artefatos tecnicos reproduziveis.',
      ].join('\n'),
      syllabus: 'Conceitos, tecnicas e aplicacoes em contexto academico.',
      methodology: 'Aulas dialogadas, estudos de caso e laboratorio supervisionado.',
      learningAssessment: 'Projeto aplicado, seminario tecnico e avaliacao escrita.',
      referencesBasic: [
        'PRESSMAN, Roger. Engenharia de Software. 2016.',
        'SOMMERVILLE, Ian. Engenharia de Software. 2019.',
      ].join('\n'),
      referencesComplementary: [
        'ABNT NBR 6023. Informacao e documentacao - Referencias. 2018.',
        'Portal UFBA https://ufba.br',
      ].join('\n'),
    },
  },
  {
    fileName: 'docx-longa-IC902.docx',
    data: {
      ...buildCommon(),
      id: 'sample-long',
      code: 'IC902',
      name: 'Topicos Especiais Longa',
      program: [
        'Modulo A: fundamentos, historico e panorama institucional.',
        'Modulo B: arquitetura, integracao e governanca.',
        'Modulo C: seguranca, rastreabilidade e qualidade.',
        'Modulo D: validacao experimental com estudos reais.',
        'Modulo E: consolidacao de evidencias para monografia.',
      ].join('\n'),
      objective: [
        'Consolidar competencias para desenhar solucoes sustentaveis.',
        'Aplicar principios SOLID e padroes de projeto em fluxos academicos.',
        'Estruturar evidencias tecnicas para defesa de TCC.',
        'Garantir conformidade documental e rastreabilidade ponta a ponta.',
      ].join('\n'),
      syllabus: [
        'Arquitetura de sistemas academicos orientados a processo.',
        'Padroes de integracao e controle de qualidade documental.',
        'Validacao de exportacao oficial em DOCX/PDF com guardrails.',
      ].join(' '),
      methodology: [
        'Aulas expositivas, laboratorios orientados e revisoes por pares.',
        'Aplicacao incremental com criterios objetivos de aceite.',
      ].join(' '),
      learningAssessment: [
        'Avaliacao continua por entregas tecnicas.',
        'Relatorio final com reproducibilidade e rastreabilidade comprovadas.',
      ].join(' '),
      referencesBasic: [
        'MARTIN, Robert C. Clean Architecture. 2017.',
        'FOWLER, Martin. Refactoring. 2018.',
        'GAMMA, Erich et al. Design Patterns. 1994.',
      ].join('\n'),
      referencesComplementary: [
        'ABNT NBR 6023. Informacao e documentacao - Referencias. 2018.',
        'ABNT NBR 10520. Citacoes em documentos. 2023.',
        'Repositorio Institucional UFBA https://repositorio.ufba.br',
      ].join('\n'),
    },
  },
];

const main = () => {
  ensureDir();
  const service = createServiceWithoutDb();

  samples.forEach(({ fileName, data }) => {
    const buffer = (service as any).fillDocxTemplateFromBase(data) as Buffer;
    const targetPath = path.join(outputDir, fileName);
    fs.writeFileSync(targetPath, buffer);
    console.log(`[docx-samples] generated: ${targetPath}`);
  });
};

main();


