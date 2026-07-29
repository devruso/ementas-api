import axios from 'axios';

import { CrawlerService } from '../services/CrawlerService';
import { AcademicLevel } from '../interfaces/AcademicLevel';
import { IComponentInfoCrawler } from '../interfaces/IComponentInfoCrawler';

jest.mock('axios');

describe('CrawlerService SIGAA enrichment throughput', () => {
    const mockedAxios = axios as jest.Mocked<typeof axios>;

    beforeEach(() => {
        mockedAxios.get.mockReset();
        mockedAxios.post.mockReset();
    });

    it('should deduplicate in-flight detail fetches by component identifier', async () => {
        const service = Object.create(CrawlerService.prototype) as CrawlerService;
        const fetchSpy = jest
            .spyOn(service as any, 'fetchSigaaComponentDetail')
            .mockImplementation(async () => ({
                prerequeriments: 'MAT001',
                coRequisites: ['FIS001'],
                equivalences: ['MATA10'],
                syllabus: 'Conteudo de teste',
                workload: {
                    theoretical: 60,
                    practice: 0,
                    internship: 0,
                    extension: 0,
                },
            }));

        const baseComponent: IComponentInfoCrawler = {
            code: 'MAT999',
            name: 'Disciplina Teste',
            department: 'DCC',
            semester: '',
            description: '',
            objective: '',
            syllabus: '',
            bibliography: '',
            prerequeriments: 'NAO_SE_APLICA',
            methodology: '',
            modality: 'DISCIPLINA',
            learningAssessment: '',
            academicLevel: AcademicLevel.GRADUATION,
            workload: {
                theoretical: 60,
                practice: 0,
                internship: 0,
            },
            detailActionUrl: 'https://sigaa.ufba.br/sigaa/public/componentes/busca_componentes.jsf',
            detailActionPayload:
                'javax.faces.ViewState=j_id1&idComponente=45325&formListagemComponentes=formListagemComponentes',
        };

        const components: IComponentInfoCrawler[] = [
            { ...baseComponent, code: 'MAT999A' },
            { ...baseComponent, code: 'MAT999B' },
            { ...baseComponent, code: 'MAT999C' },
        ];

        const result = await service.enrichSigaaComponentsFromPublicDetails(components, 3);

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(result.every((component) => component.syllabus === 'Conteudo de teste')).toBe(true);
        expect(result.every((component) => component.prerequeriments === 'MAT001')).toBe(true);
    });

    it('should merge SIGAA detail and current program payloads during enrichment', async () => {
        const service = Object.create(CrawlerService.prototype) as CrawlerService;
        (service as any).requestTimeoutMs = 45000;

        mockedAxios.post
            .mockResolvedValueOnce({
                data: Buffer.from(
                    '<html><body><table><tr><th>Pré-Requisitos</th><td>MATA07</td></tr><tr><th>Ementa/Descrição</th><td>Fundamentos de redes.</td></tr><tr><th>Carga Horária Teórica</th><td>45 h.</td></tr></table></body></html>',
                    'utf8'
                ),
            } as any)
            .mockResolvedValueOnce({
                data: Buffer.from(
                    '<html><body><table><tr><th>Conteúdo Programático</th><td>Camada física, enlace e redes IP.</td></tr><tr><th>Referências Básicas</th><td>KUROSE, J. Redes de Computadores. 2021.</td></tr><tr><th>Referências Complementares</th><td>TANENBAUM, A. Redes de Computadores. 2011.</td></tr></table></body></html>',
                    'utf8'
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
});
