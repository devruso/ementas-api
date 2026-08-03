import axios from 'axios';
import { getCustomRepository } from 'typeorm';

import { CrawlerService } from '../services/CrawlerService';
import { AcademicLevel } from '../interfaces/AcademicLevel';
import { UserRepository } from '../repositories/UserRepository';
import { ComponentRepository } from '../repositories/ComponentRepository';
import { ComponentRelationRepository } from '../repositories/ComponentRelationRepository';
import { ComponentCurriculumContextRepository } from '../repositories/ComponentCurriculumContextRepository';
import { UserRole } from '../interfaces/UserRole';
import { ComponentRelationType } from '../interfaces/ComponentRelationType';
import connection from './connection';

jest.mock('axios');

describe('CrawlerService SIGAA import integration', () => {
    const mockedAxios = axios as jest.Mocked<typeof axios>;

  beforeAll(async () => {
    await connection.create();
  });

  afterAll(async () => {
    await connection.close();
  });

    beforeEach(async () => {
      await connection.clear();
        mockedAxios.get.mockReset();
        mockedAxios.post.mockReset();
    });

    it('should prefer JSF search flow before direct source fallback', async () => {
        const service = Object.create(CrawlerService.prototype) as CrawlerService;

        (service as any).getSigaaSourceUrls = jest.fn().mockReturnValue([
            'https://sigaa.ufba.br/sigaa/public/programa/curriculo.jsf?lc=pt_BR&id=1820',
        ]);

        const createComponentSpy = jest
            .spyOn(service as any, 'createComponent')
            .mockResolvedValue(undefined);

        const jsfSearchFormPage = `
            <html>
              <body>
                <form id="form" action="/sigaa/public/componentes/busca_componentes.jsf">
                  <input type="hidden" name="javax.faces.ViewState" value="j_id2" />
                </form>
              </body>
            </html>
        `;
        const jsfSearchResultPage = `
            <html>
              <body>
                <table>
                  <tr>
                    <td>PGCOMP/IC0032</td>
                    <td>BANCO DE DADOS</td>
                    <td>PROGRAMA DE POS-GRADUACAO EM CIENCIA DA COMPUTACAO</td>
                  </tr>
                </table>
              </body>
            </html>
        `;

        mockedAxios.get.mockResolvedValueOnce({ data: Buffer.from(jsfSearchFormPage, 'latin1') } as any);

        mockedAxios.post.mockResolvedValueOnce({
            data: Buffer.from(jsfSearchResultPage, 'latin1'),
        } as any);

        await service.importComponentsFromSigaaPublic(
            'user-1',
            'program',
            '1820',
            AcademicLevel.MASTERS
        );

        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
        expect(mockedAxios.post).toHaveBeenCalledTimes(1);

        const [postUrl, postBody] = mockedAxios.post.mock.calls[0];
        expect(postUrl).toContain('/sigaa/public/componentes/busca_componentes.jsf');
        expect(postBody).toContain('form%3Anivel=S');
        expect(postBody).toContain('form%3Atipo=2');
        expect(postBody).toContain('form%3Aunidades=1820');

        expect(createComponentSpy).toHaveBeenCalledWith(
            'user-1',
            expect.objectContaining({
                code: 'IC0032',
                name: 'BANCO DE DADOS',
                academicLevel: AcademicLevel.MASTERS,
            })
        );
    });

    it('should persist component relations from SIGAA detail enrichment during import', async () => {
        const service = new CrawlerService();
        const userRepository = getCustomRepository(UserRepository);
        const componentRepository = getCustomRepository(ComponentRepository);
        const componentRelationRepository = getCustomRepository(ComponentRelationRepository);

        const user = await userRepository.save(userRepository.create({
            name: 'Crawler Import Admin',
            email: 'crawler-import-admin@test.com',
            password: '123456',
            role: UserRole.ADMIN,
        }));

        (service as any).getSigaaSourceUrls = jest.fn().mockReturnValue([
            'https://sigaa.ufba.br/sigaa/public/programa/curriculo.jsf?lc=pt_BR&id=1820',
        ]);

        mockedAxios.get.mockResolvedValueOnce({
            data: Buffer.from('<html><body><p>Nenhuma turma encontrada</p></body></html>', 'latin1'),
        } as any);

        jest.spyOn(service as any, 'searchSigaaComponentsByUnit').mockResolvedValue([
            {
                code: 'IC0032',
                name: 'BANCO DE DADOS',
                department: 'PGCOMP',
                semester: '',
                description: 'desc',
                objective: '',
                syllabus: '',
                bibliography: '',
                prerequeriments: 'NAO_SE_APLICA',
                methodology: '',
                modality: 'DISCIPLINA',
                learningAssessment: '',
                academicLevel: AcademicLevel.MASTERS,
                workload: { theoretical: 60, practice: 0, internship: 0 },
                detailActionUrl: 'https://sigaa.ufba.br/sigaa/public/componentes/busca_componentes.jsf',
                detailActionPayload: 'idComponente=45325',
            },
        ]);

        jest.spyOn(service as any, 'enrichSigaaComponentsFromPublicDetails').mockResolvedValue([
            {
                code: 'IC0032',
                name: 'BANCO DE DADOS',
                department: 'PGCOMP',
                semester: '',
                description: 'desc',
                objective: '',
                syllabus: 'Introdução aos sistemas computacionais.',
                bibliography: '',
                prerequeriments: 'MAT001',
                methodology: '',
                modality: 'DISCIPLINA',
                learningAssessment: '',
                academicLevel: AcademicLevel.MASTERS,
                workload: { theoretical: 45, practice: 15, internship: 0 },
                coRequisites: ['FIS001', 'FIS002'],
                equivalences: ['MATX01', 'MATX02'],
            },
        ]);

        const result = await service.importComponentsFromSigaaPublic(
            user.id,
            'program',
            '1820',
            AcademicLevel.MASTERS
        );

        const component = await componentRepository.findOne({ where: { code: 'IC0032' } });
        const relations = await componentRelationRepository.find({ where: { componentId: component?.id } });

        expect(result).toMatchObject({
            requested: 1,
            created: 1,
            skippedExisting: 0,
            failed: 0,
        });
        expect(component).toBeTruthy();
        expect(relations).toHaveLength(4);
        expect(relations).toEqual(expect.arrayContaining([
            expect.objectContaining({ relationType: ComponentRelationType.CO_REQUISITE, relatedCode: 'FIS001' }),
            expect.objectContaining({ relationType: ComponentRelationType.CO_REQUISITE, relatedCode: 'FIS002' }),
            expect.objectContaining({ relationType: ComponentRelationType.EQUIVALENCE, relatedCode: 'MATX01' }),
            expect.objectContaining({ relationType: ComponentRelationType.EQUIVALENCE, relatedCode: 'MATX02' }),
        ]));
    });

    it('should persist SIGAA course curriculum contexts during import', async () => {
        const service = new CrawlerService();
        const userRepository = getCustomRepository(UserRepository);
        const componentRepository = getCustomRepository(ComponentRepository);
        const curriculumContextRepository = getCustomRepository(ComponentCurriculumContextRepository);

        const user = await userRepository.save(userRepository.create({
            name: 'Crawler Curriculum Admin',
            email: 'crawler-curriculum-admin@test.com',
            password: '123456',
            role: UserRole.ADMIN,
        }));

        await service.createComponent(user.id, {
            code: 'IC0009',
            name: 'INTRODUCAO A PROGRAMACAO',
            department: 'INSTITUTO DE COMPUTACAO',
            semester: '2025.1',
            description: 'conteudo',
            objective: '',
            syllabus: 'ementa',
            bibliography: '',
            prerequeriments: 'NAO_SE_APLICA',
            methodology: '',
            modality: 'DISCIPLINA',
            learningAssessment: '',
            academicLevel: AcademicLevel.GRADUATION,
            workload: { theoretical: 60, practice: 0, internship: 0 },
            curriculumContexts: [
                {
                    curriculumCode: 'G20251',
                    curriculumName: 'CIENCIA DA COMPUTACAO - SALVADOR - BACHARELADO - Presencial - MT',
                    implementationSemester: '2025.1',
                    recommendedPeriod: 1,
                    isRequired: true,
                    isActive: true,
                    academicLevel: AcademicLevel.GRADUATION,
                },
                {
                    curriculumCode: 'G20252',
                    curriculumName: 'SISTEMAS DE INFORMACAO - SALVADOR - BACHARELADO - Presencial - MT',
                    implementationSemester: '2025.1',
                    recommendedPeriod: 2,
                    isRequired: false,
                    isActive: true,
                    academicLevel: AcademicLevel.GRADUATION,
                },
            ],
        });

        const component = await componentRepository.findOne({ where: { code: 'IC0009' } });
        const contexts = await curriculumContextRepository.find({
            where: { componentId: component?.id },
            order: { recommendedPeriod: 'ASC' } as any,
        });

        expect(contexts).toHaveLength(2);
        expect(contexts).toEqual(expect.arrayContaining([
            expect.objectContaining({
                curriculumCode: 'G20251',
                courseName: 'CIENCIA DA COMPUTACAO',
                implementationSemester: '2025.1',
                recommendedPeriod: 1,
                isRequired: true,
                isActive: true,
            }),
            expect.objectContaining({
                curriculumCode: 'G20252',
                courseName: 'SISTEMAS DE INFORMACAO',
                recommendedPeriod: 2,
                isRequired: false,
            }),
        ]));
    });

    it('should fallback to secondary JSF payload when first onclick payload returns non-detail page', async () => {
        const service = new CrawlerService();

        mockedAxios.post
            .mockResolvedValueOnce({
                data: Buffer.from('<html><body><h1>Busca de Componentes</h1><form id="formListagemComponentes"></form></body></html>', 'latin1'),
            } as any)
            .mockResolvedValueOnce({
                data: Buffer.from(
                    '<html><body><table><tr><th>Pré-Requisitos</th><td>MATA07</td></tr><tr><th>Ementa</th><td>Fundamentos de redes.</td></tr></table></body></html>',
                    'latin1'
                ),
            } as any);

        const detail = await (service as any).fetchSigaaComponentDetail({
            code: 'MATA85',
            detailActionUrl: 'https://sigaa.ufba.br/sigaa/public/departamento/componentes.jsf',
            detailActionPayload: 'form=a&idComponente=111',
            detailActionPayloadCandidates: ['form=a&idComponente=111', 'form=a&id=222&publico=public'],
            detailRequestCookie: 'JSESSIONID=abc123',
        });

        expect(mockedAxios.post).toHaveBeenCalledTimes(2);
        expect(mockedAxios.post.mock.calls[0][1]).toContain('idComponente=111');
        expect(mockedAxios.post.mock.calls[1][1]).toContain('id=222');
        expect(detail).toEqual(
            expect.objectContaining({
                prerequeriments: 'MATA07',
                syllabus: 'Fundamentos de redes.',
            })
        );
    });

    it('should merge SIGAA detail and current program payloads during enrichment', async () => {
        const service = new CrawlerService();

        mockedAxios.post
            .mockResolvedValueOnce({
                data: Buffer.from(
                    '<html><body><table><tr><th>PrÃ©-Requisitos</th><td>MATA07</td></tr><tr><th>Ementa/DescriÃ§Ã£o</th><td>Fundamentos de redes.</td></tr><tr><th>Carga HorÃ¡ria TeÃ³rica</th><td>45 h.</td></tr></table></body></html>',
                    'latin1'
                ),
            } as any)
            .mockResolvedValueOnce({
                data: Buffer.from(
                    '<html><body><table><tr><th>ConteÃºdo ProgramÃ¡tico</th><td>Camada fÃ­sica, enlace e redes IP.</td></tr><tr><th>ReferÃªncias BÃ¡sicas</th><td>KUROSE, J. Redes de Computadores. 2021.</td></tr><tr><th>ReferÃªncias Complementares</th><td>TANENBAUM, A. Redes de Computadores. 2011.</td></tr></table></body></html>',
                    'latin1'
                ),
            } as any);

        const detail = await (service as any).fetchSigaaComponentDetail({
            code: 'MATA85',
            detailActionUrl: 'https://sigaa.ufba.br/sigaa/public/departamento/componentes.jsf',
            detailActionPayload: 'form=a&id=222&publico=public',
            detailActionPayloadCandidates: ['form=a&id=222&publico=public', 'form=a&idComponente=111'],
            detailRequestCookie: 'JSESSIONID=abc123',
        });

        expect(mockedAxios.post).toHaveBeenCalledTimes(2);
        expect(detail).toEqual(
            expect.objectContaining({
                prerequeriments: 'MATA07',
                syllabus: 'Fundamentos de redes.',
                description: 'Camada física, enlace e redes IP.',
                referencesBasic: 'KUROSE, J. Redes de Computadores. 2021.',
                referencesComplementary: 'TANENBAUM, A. Redes de Computadores. 2011.',
                workload: expect.objectContaining({
                    theoretical: 45,
                }),
            })
        );
    });

    it('should normalize enumerated syllabus into running text for imported crawler data', () => {
        const service = new CrawlerService();

        const sanitized = (service as any).sanitizeImportedComponentData({
            code: 'IC0999',
            name: 'DISCIPLINA TESTE',
            department: 'Departamento de Testes',
            semester: '2026.1',
            description: 'Conteúdo base',
            objective: 'Objetivo base',
            syllabus: '1. Fundamentos da área\n2. Modelagem conceitual\n- Estudos aplicados',
            bibliography: 'Bibliografia base',
            prerequeriments: 'NAO_SE_APLICA',
            methodology: 'Metodologia base',
            modality: 'DISCIPLINA',
            learningAssessment: 'Avaliação base',
            academicLevel: AcademicLevel.GRADUATION,
            workload: { theoretical: 60, practice: 0, internship: 0 },
        });

        expect(sanitized.syllabus).toBe('Fundamentos da área Modelagem conceitual Estudos aplicados');
    });

    it('should pick canonical SIGAA entry with richer prerequisites when same code appears multiple times', () => {
        const service = new CrawlerService();

        const canonical = (service as any).selectCanonicalComponentsByCode([
            {
                code: 'IC0040',
                name: 'REDES DE COMPUTADORES',
                department: 'PROGRAMA DE POS-GRADUACAO EM CIENCIA DA COMPUTACAO',
                semester: '',
                description: 'desc',
                objective: '',
                syllabus: 'Conteúdo resumido',
                bibliography: '',
                prerequeriments: 'NAO_SE_APLICA',
                methodology: '',
                modality: 'DISCIPLINA',
                learningAssessment: '',
                academicLevel: AcademicLevel.GRADUATION,
                workload: { theoretical: 60, practice: 0, internship: 0 },
            },
            {
                code: 'IC0040',
                name: 'REDES DE COMPUTADORES',
                department: 'INSTITUTO DE COMPUTACAO',
                semester: '',
                description: 'desc',
                objective: 'Compreender arquiteturas e protocolos de rede.',
                syllabus: 'Modelo OSI, arquitetura de computadores, protocolos e redes locais.',
                bibliography: '',
                prerequeriments: 'MATA37, IC0008',
                methodology: 'Aulas expositivas e laboratório.',
                modality: 'DISCIPLINA',
                learningAssessment: 'Avaliação continuada',
                academicLevel: AcademicLevel.GRADUATION,
                workload: { theoretical: 60, practice: 0, internship: 0 },
            },
        ]);

        expect(canonical).toHaveLength(1);
        expect(canonical[0]).toEqual(
            expect.objectContaining({
                code: 'IC0040',
                prerequeriments: 'MATA37, IC0008',
                department: 'INSTITUTO DE COMPUTACAO',
            })
        );
    });

    it('should repair mojibake in imported crawler fields', () => {
        const service = new CrawlerService();

        const sanitized = (service as any).sanitizeImportedComponentData({
            code: 'IC0888',
            name: 'TÃ³picos em ComputaÃ§Ã£o Visual II',
            department: 'Programa de PÃ³s-GraduaÃ§Ã£o em CiÃªncia da ComputaÃ§Ã£o',
            semester: '2026.1',
            description: 'ConteÃºdo programÃ¡tico base',
            objective: 'Objetivo base',
            syllabus: '1. IntroduÃ§Ã£o\n2. AplicaÃ§Ãµes',
            bibliography: 'Bibliografia bÃ¡sica',
            prerequeriments: 'NAO_SE_APLICA',
            methodology: 'Metodologia padrÃ£o',
            modality: 'DISCIPLINA',
            learningAssessment: 'AvaliaÃ§Ã£o contÃ­nua',
            academicLevel: AcademicLevel.MASTERS,
            workload: { theoretical: 45, practice: 0, internship: 0 },
        });

        expect(sanitized.name).toBe('Tópicos em Computação Visual II');
        expect(sanitized.department).toBe('Programa de Pós-Graduação em Ciência da Computação');
        expect(sanitized.description).toBe('Conteúdo programático base');
        expect(sanitized.syllabus).toBe('Introdução Aplicações');
        expect(sanitized.learningAssessment).toBe('Avaliação contínua');
    });

    it('should decode UTF-8 SIGAA pages without corrupting portuguese text', () => {
        const service = new CrawlerService();
        const htmlBuffer = Buffer.from('<html><body><table><tr><td>IC0009</td><td>TÓPICOS EM COMPUTAÇÃO VISUAL I</td></tr></table></body></html>', 'utf8');

        const decoded = (service as any).decodeHtmlBuffer(htmlBuffer);

        expect(decoded).toContain('TÓPICOS EM COMPUTAÇÃO VISUAL I');
    });

    it('should skip existing component and preserve stored data during SIGAA import', async () => {
        const service = new CrawlerService();
        const userRepository = getCustomRepository(UserRepository);
        const componentRepository = getCustomRepository(ComponentRepository);

        const user = await userRepository.save(userRepository.create({
            name: 'Crawler Preserve Admin',
            email: 'crawler-preserve-admin@test.com',
            password: '123456',
            role: UserRole.ADMIN,
        }));

        await service.createComponent(user.id, {
            code: 'IC0032',
            name: 'BANCO DE DADOS ORIGINAL',
            department: 'PGCOMP',
            semester: '2026.1',
            description: 'conteudo original',
            objective: 'objetivo original',
            syllabus: 'ementa original',
            bibliography: 'bibliografia original',
            prerequeriments: 'MAT001',
            methodology: 'metodologia original',
            modality: 'DISCIPLINA',
            learningAssessment: 'avaliacao original',
            academicLevel: AcademicLevel.MASTERS,
            workload: { theoretical: 60, practice: 0, internship: 0 },
        });

        jest.spyOn(service as any, 'getSigaaSourceUrls').mockReturnValue([
            'https://sigaa.ufba.br/sigaa/public/programa/curriculo.jsf?lc=pt_BR&id=1820',
        ]);

        mockedAxios.get.mockResolvedValueOnce({
            data: Buffer.from('<html><body><p>Nenhuma turma encontrada</p></body></html>', 'latin1'),
        } as any);

        jest.spyOn(service as any, 'searchSigaaComponentsByUnit').mockResolvedValue([
            {
                code: 'IC0032',
                name: 'BANCO DE DADOS NOVO',
                department: 'PGCOMP NOVO',
                semester: '',
                description: 'desc nova',
                objective: '',
                syllabus: '',
                bibliography: '',
                prerequeriments: 'NAO_SE_APLICA',
                methodology: '',
                modality: 'DISCIPLINA',
                learningAssessment: '',
                academicLevel: AcademicLevel.MASTERS,
                workload: { theoretical: 30, practice: 30, internship: 0 },
            },
        ]);

        jest.spyOn(service as any, 'enrichSigaaComponentsFromPublicDetails').mockResolvedValue([
            {
                code: 'IC0032',
                name: 'BANCO DE DADOS NOVO',
                department: 'PGCOMP NOVO',
                semester: '',
                description: 'desc nova',
                objective: 'objetivo novo',
                syllabus: 'ementa nova',
                bibliography: '',
                prerequeriments: 'MAT999',
                methodology: '',
                modality: 'DISCIPLINA',
                learningAssessment: '',
                academicLevel: AcademicLevel.MASTERS,
                workload: { theoretical: 30, practice: 30, internship: 0 },
            },
        ]);

        const result = await service.importComponentsFromSigaaPublic(
            user.id,
            'program',
            '1820',
            AcademicLevel.MASTERS
        );

        const persisted = await componentRepository.findOne({ where: { code: 'IC0032' } });

        expect(result).toMatchObject({
            requested: 1,
            created: 0,
            skippedExisting: 1,
            failed: 0,
        });
        expect(persisted).toBeTruthy();
        expect(persisted?.name).toBe('BANCO DE DADOS ORIGINAL');
        expect(persisted?.department).toBe('Programa de Pós-Graduação em Ciência da Computação');
        expect(persisted?.semester).toBe('2026.1');
        expect(persisted?.program).toBe('conteudo original');
        expect(persisted?.syllabus).toBe('ementa original');
        expect(persisted?.prerequeriments).toBe('MAT001');
    });

    it('should reject invalid SIGAA component payload and keep database unchanged', async () => {
        const service = new CrawlerService();
        const userRepository = getCustomRepository(UserRepository);
        const componentRepository = getCustomRepository(ComponentRepository);

        const user = await userRepository.save(userRepository.create({
            name: 'Crawler Validation Admin',
            email: 'crawler-validation-admin@test.com',
            password: '123456',
            role: UserRole.ADMIN,
        }));

        jest.spyOn(service as any, 'getSigaaSourceUrls').mockReturnValue([
            'https://sigaa.ufba.br/sigaa/public/programa/curriculo.jsf?lc=pt_BR&id=1820',
        ]);

        mockedAxios.get.mockResolvedValueOnce({
            data: Buffer.from('<html><body><p>Nenhuma turma encontrada</p></body></html>', 'latin1'),
        } as any);

        jest.spyOn(service as any, 'searchSigaaComponentsByUnit').mockResolvedValue([
            {
                code: 'INVALID-CODE',
                name: 'DISCIPLINA INVALIDA',
                department: 'PGCOMP',
                semester: '',
                description: 'desc',
                objective: '',
                syllabus: '',
                bibliography: '',
                prerequeriments: '',
                methodology: '',
                modality: 'DISCIPLINA',
                learningAssessment: '',
                academicLevel: AcademicLevel.MASTERS,
                workload: { theoretical: 45, practice: 15, internship: 0 },
            },
        ]);

        jest.spyOn(service as any, 'enrichSigaaComponentsFromPublicDetails').mockResolvedValue([
            {
                code: 'INVALID-CODE',
                name: 'DISCIPLINA INVALIDA',
                department: 'PGCOMP',
                semester: '',
                description: 'desc',
                objective: '',
                syllabus: '',
                bibliography: '',
                prerequeriments: '',
                methodology: '',
                modality: 'DISCIPLINA',
                learningAssessment: '',
                academicLevel: AcademicLevel.MASTERS,
                workload: { theoretical: 45, practice: 15, internship: 0 },
            },
        ]);

        const result = await service.importComponentsFromSigaaPublic(
            user.id,
            'program',
            '1820',
            AcademicLevel.MASTERS
        );

        const persisted = await componentRepository.find({ where: { userId: user.id } as any });

        expect(result).toMatchObject({
            requested: 1,
            created: 0,
            skippedExisting: 0,
            failed: 1,
        });
        expect(result.failureCategories).toMatchObject({
            invalid_code: 1,
        });
        expect(result.failures.join(' ')).toContain('Invalid component code from source.');
        expect(persisted).toHaveLength(0);
    });

    it('should categorize batch failures by validation reason during SIGAA import', async () => {
        const service = new CrawlerService();
        const userRepository = getCustomRepository(UserRepository);
        const componentRepository = getCustomRepository(ComponentRepository);

        const user = await userRepository.save(userRepository.create({
            name: 'Crawler Categorization Admin',
            email: 'crawler-categorization-admin@test.com',
            password: '123456',
            role: UserRole.ADMIN,
        }));

        jest.spyOn(service as any, 'getSigaaSourceUrls').mockReturnValue([
            'https://sigaa.ufba.br/sigaa/public/programa/curriculo.jsf?lc=pt_BR&id=1820',
        ]);

        mockedAxios.get.mockResolvedValue({
            data: Buffer.from('<html><body><p>Nenhuma turma encontrada</p></body></html>', 'latin1'),
        } as any);

        jest.spyOn(service as any, 'searchSigaaComponentsByUnit').mockResolvedValue([
            {
                code: 'INVALID-CODE',
                name: 'DISCIPLINA INVALIDA',
                department: 'PGCOMP',
                semester: '',
                description: 'desc invalida',
                objective: '',
                syllabus: '',
                bibliography: '',
                prerequeriments: '',
                methodology: '',
                modality: 'DISCIPLINA',
                learningAssessment: '',
                academicLevel: AcademicLevel.MASTERS,
                workload: { theoretical: 45, practice: 15, internship: 0 },
            },
            {
                code: 'IC0033',
                name: '   ',
                department: 'PGCOMP',
                semester: '',
                description: 'sem nome',
                objective: '',
                syllabus: '',
                bibliography: '',
                prerequeriments: '',
                methodology: '',
                modality: 'DISCIPLINA',
                learningAssessment: '',
                academicLevel: AcademicLevel.MASTERS,
                workload: { theoretical: 30, practice: 30, internship: 0 },
            },
            {
                code: 'IC0034',
                name: 'DISCIPLINA VALIDA',
                department: 'PGCOMP',
                semester: '',
                description: 'desc valida',
                objective: '',
                syllabus: '',
                bibliography: '',
                prerequeriments: '',
                methodology: '',
                modality: 'DISCIPLINA',
                learningAssessment: '',
                academicLevel: AcademicLevel.MASTERS,
                workload: { theoretical: 60, practice: 0, internship: 0 },
            },
        ]);

        jest.spyOn(service as any, 'enrichSigaaComponentsFromPublicDetails').mockResolvedValue([
            {
                code: 'INVALID-CODE',
                name: 'DISCIPLINA INVALIDA',
                department: 'PGCOMP',
                semester: '',
                description: 'desc invalida',
                objective: '',
                syllabus: '',
                bibliography: '',
                prerequeriments: '',
                methodology: '',
                modality: 'DISCIPLINA',
                learningAssessment: '',
                academicLevel: AcademicLevel.MASTERS,
                workload: { theoretical: 45, practice: 15, internship: 0 },
            },
            {
                code: 'IC0033',
                name: '   ',
                department: 'PGCOMP',
                semester: '',
                description: 'sem nome',
                objective: '',
                syllabus: '',
                bibliography: '',
                prerequeriments: '',
                methodology: '',
                modality: 'DISCIPLINA',
                learningAssessment: '',
                academicLevel: AcademicLevel.MASTERS,
                workload: { theoretical: 30, practice: 30, internship: 0 },
            },
            {
                code: 'IC0034',
                name: 'DISCIPLINA VALIDA',
                department: 'PGCOMP',
                semester: '',
                description: 'desc valida',
                objective: '',
                syllabus: '',
                bibliography: '',
                prerequeriments: '',
                methodology: '',
                modality: 'DISCIPLINA',
                learningAssessment: '',
                academicLevel: AcademicLevel.MASTERS,
                workload: { theoretical: 60, practice: 0, internship: 0 },
            },
        ]);

        const result = await service.importComponentsFromSigaaPublic(
            user.id,
            'program',
            '1820',
            AcademicLevel.MASTERS
        );

        const persisted = await componentRepository.find({ where: { userId: user.id } as any });

        expect(result).toMatchObject({
            requested: 3,
            created: 1,
            skippedExisting: 0,
            failed: 2,
        });
        expect(result.failureCategories).toMatchObject({
            invalid_code: 1,
            invalid_name: 1,
        });
        expect(persisted).toHaveLength(1);
        expect(persisted[0].code).toBe('IC0034');
    });

    it('should keep batch import invariant on repeated execution', async () => {
        const service = new CrawlerService();
        const userRepository = getCustomRepository(UserRepository);
        const componentRepository = getCustomRepository(ComponentRepository);

        const user = await userRepository.save(userRepository.create({
            name: 'Crawler Repeatability Admin',
            email: 'crawler-repeatability-admin@test.com',
            password: '123456',
            role: UserRole.ADMIN,
        }));

        const batchPayload = [
            {
                code: 'IC0101',
                name: 'ALGORITMOS AVANCADOS',
                department: 'PGCOMP',
                semester: '',
                description: 'descricao 1',
                objective: '',
                syllabus: 'ementa 1',
                bibliography: '',
                prerequeriments: 'MAT001',
                methodology: '',
                modality: 'DISCIPLINA',
                learningAssessment: '',
                academicLevel: AcademicLevel.MASTERS,
                workload: { theoretical: 45, practice: 15, internship: 0 },
            },
            {
                code: 'IC0102',
                name: 'SISTEMAS DISTRIBUIDOS',
                department: 'PGCOMP',
                semester: '',
                description: 'descricao 2',
                objective: '',
                syllabus: 'ementa 2',
                bibliography: '',
                prerequeriments: 'IC0101',
                methodology: '',
                modality: 'DISCIPLINA',
                learningAssessment: '',
                academicLevel: AcademicLevel.MASTERS,
                workload: { theoretical: 60, practice: 0, internship: 0 },
            },
            {
                code: 'IC0103',
                name: 'ENGENHARIA DE DADOS',
                department: 'PGCOMP',
                semester: '',
                description: 'descricao 3',
                objective: '',
                syllabus: 'ementa 3',
                bibliography: '',
                prerequeriments: 'NAO_SE_APLICA',
                methodology: '',
                modality: 'DISCIPLINA',
                learningAssessment: '',
                academicLevel: AcademicLevel.MASTERS,
                workload: { theoretical: 30, practice: 30, internship: 0 },
            },
        ];

        jest.spyOn(service as any, 'getSigaaSourceUrls').mockReturnValue([
            'https://sigaa.ufba.br/sigaa/public/programa/curriculo.jsf?lc=pt_BR&id=1820',
        ]);

        mockedAxios.get.mockResolvedValue({
            data: Buffer.from('<html><body><p>Nenhuma turma encontrada</p></body></html>', 'latin1'),
        } as any);

        jest.spyOn(service as any, 'searchSigaaComponentsByUnit').mockImplementation(async () => batchPayload);
        jest.spyOn(service as any, 'enrichSigaaComponentsFromPublicDetails').mockImplementation(async () => batchPayload);

        const firstResult = await service.importComponentsFromSigaaPublic(
            user.id,
            'program',
            '1820',
            AcademicLevel.MASTERS
        );

        const firstSnapshot = (await componentRepository.find({ order: { code: 'ASC' } as any }))
            .map((component) => ({
                code: component.code,
                name: component.name,
                department: component.department,
                program: component.program,
                syllabus: component.syllabus,
                prerequeriments: component.prerequeriments,
            }));

        const secondResult = await service.importComponentsFromSigaaPublic(
            user.id,
            'program',
            '1820',
            AcademicLevel.MASTERS
        );

        const secondSnapshot = (await componentRepository.find({ order: { code: 'ASC' } as any }))
            .map((component) => ({
                code: component.code,
                name: component.name,
                department: component.department,
                program: component.program,
                syllabus: component.syllabus,
                prerequeriments: component.prerequeriments,
            }));

        expect(firstResult).toMatchObject({
            requested: 3,
            created: 3,
            skippedExisting: 0,
            failed: 0,
        });
        expect(secondResult).toMatchObject({
            requested: 3,
            created: 0,
            skippedExisting: 3,
            failed: 0,
        });
        expect(firstSnapshot).toHaveLength(3);
        expect(secondSnapshot).toHaveLength(3);
        expect(secondSnapshot).toEqual(firstSnapshot);
    });

    it('should not use direct source fallback when JSF search succeeds', async () => {
        const service = new CrawlerService();
        const userRepository = getCustomRepository(UserRepository);

        const user = await userRepository.save(userRepository.create({
            name: 'Crawler Timeout Admin',
            email: 'crawler-timeout-admin@test.com',
            password: '123456',
            role: UserRole.ADMIN,
        }));

        jest.spyOn(service as any, 'getSigaaSourceUrls').mockReturnValue([
            'https://sigaa.ufba.br/sigaa/public/programa/curriculo.jsf?lc=pt_BR&id=source-timeout',
            'https://sigaa.ufba.br/sigaa/public/programa/curriculo.jsf?lc=pt_BR&id=source-ok',
        ]);

        mockedAxios.get
            .mockRejectedValueOnce(Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' }))
            .mockResolvedValueOnce({
                data: Buffer.from('<html><body><p>Nenhuma turma encontrada</p></body></html>', 'latin1'),
            } as any);

        jest.spyOn(service as any, 'searchSigaaComponentsByUnit').mockResolvedValue([
            {
                code: 'IC0201',
                name: 'COMPUTACAO ESCALAVEL',
                department: 'PGCOMP',
                semester: '',
                description: 'descricao',
                objective: '',
                syllabus: 'ementa',
                bibliography: '',
                prerequeriments: 'NAO_SE_APLICA',
                methodology: '',
                modality: 'DISCIPLINA',
                learningAssessment: '',
                academicLevel: AcademicLevel.MASTERS,
                workload: { theoretical: 45, practice: 15, internship: 0 },
            },
        ]);

        jest.spyOn(service as any, 'enrichSigaaComponentsFromPublicDetails').mockResolvedValue([
            {
                code: 'IC0201',
                name: 'COMPUTACAO ESCALAVEL',
                department: 'PGCOMP',
                semester: '',
                description: 'descricao',
                objective: '',
                syllabus: 'ementa',
                bibliography: '',
                prerequeriments: 'NAO_SE_APLICA',
                methodology: '',
                modality: 'DISCIPLINA',
                learningAssessment: '',
                academicLevel: AcademicLevel.MASTERS,
                workload: { theoretical: 45, practice: 15, internship: 0 },
            },
        ]);

        const result = await service.importComponentsFromSigaaPublic(
            user.id,
            'program',
            '1820',
            AcademicLevel.MASTERS
        );

        expect(result).toMatchObject({
            requested: 1,
            created: 1,
            skippedExisting: 0,
            failed: 0,
        });
        expect(result.failureCategories).toEqual({});
        expect(result.failures).toEqual([]);
    });
});
