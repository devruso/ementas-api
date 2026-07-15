import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';

import { CrawlerService } from '../services/CrawlerService';
import { AcademicLevel } from '../interfaces/AcademicLevel';

describe('CrawlerService SIGAA parser', () => {
    const service = Object.create(CrawlerService.prototype) as CrawlerService;

    it('should ignore JS/CSS token noise when SIGAA page has no components', () => {
        const fixturePath = path.resolve(__dirname, 'fixtures/sigaa/source-department-1876851.html');
        const html = fs.readFileSync(fixturePath, 'utf-8');
        const $ = cheerio.load(html);

        const result = (service as any).extractSigaaListRows($, 'department', AcademicLevel.GRADUATION);

        expect(result).toEqual([]);
    });

    it('should extract component rows from tabular SIGAA-like HTML preserving row variants', () => {
        const html = `
            <table>
              <tr class="linhaPar">
                <td>MATA01</td>
                <td>Calculo I</td>
                <td>Departamento de Ciencia da Computacao</td>
              </tr>
              <tr class="linhaImpar">
                <td>MATB02</td>
                <td>Algoritmos</td>
                <td>DCC</td>
              </tr>
              <tr class="linhaPar">
                <td>MATA01</td>
                <td>Calculo I (duplicada)</td>
                <td>DCC</td>
              </tr>
            </table>
        `;

        const $ = cheerio.load(html);
        const result = (service as any).extractSigaaListRows($, 'department', AcademicLevel.GRADUATION);

        expect(result).toHaveLength(3);
        expect(result[0]).toEqual(
            expect.objectContaining({
                code: 'MATA01',
                name: 'Calculo I',
                department: 'Departamento de Ciencia da Computacao',
                academicLevel: AcademicLevel.GRADUATION,
            })
        );
        expect(result[1]).toEqual(
            expect.objectContaining({
                code: 'MATB02',
                name: 'Algoritmos',
            })
        );
        expect(result[2]).toEqual(
          expect.objectContaining({
            code: 'MATA01',
            name: 'Calculo I (duplicada)',
          })
        );
    });

      it('should extract code when SIGAA row has program prefix', () => {
        const html = `
          <table>
            <tr class="linhaPar">
            <td>PGCOMP/IC0032</td>
            <td>Banco de Dados</td>
            <td>DISCIPLINA</td>
            </tr>
          </table>
        `;

        const $ = cheerio.load(html);
        const result = (service as any).extractSigaaListRows($, 'program', AcademicLevel.MASTERS);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(
          expect.objectContaining({
            code: 'IC0032',
            name: 'Banco de Dados',
            academicLevel: AcademicLevel.MASTERS,
          })
        );
      });

    it('should extract workload hours and component type from SIGAA listing row', () => {
        const html = `
          <table>
            <tr class="linhaPar">
              <td>MAT154</td>
              <td>SISTEMAS OPERACIONAIS</td>
              <td>DISCIPLINA</td>
              <td>60h</td>
            </tr>
          </table>
        `;

        const $ = cheerio.load(html);
        const result = (service as any).extractSigaaListRows($, 'department', AcademicLevel.GRADUATION);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(
            expect.objectContaining({
                code: 'MAT154',
                name: 'SISTEMAS OPERACIONAIS',
                modality: 'DISCIPLINA',
                workload: {
                    theoretical: 60,
                    practice: 0,
                    internship: 0,
                },
            })
        );
    });

    it('should not treat busca form rows as curricular components', () => {
        const html = `
          <table>
            <tr>
              <td>Código do Componente:</td>
              <td>(Ex. MAT0311)</td>
            </tr>
            <tr>
              <td>Unidade Responsável:</td>
              <td>COLEGIADO XYZ</td>
            </tr>
          </table>
        `;

        const $ = cheerio.load(html);
        const result = (service as any).extractSigaaListRows($, 'department', AcademicLevel.GRADUATION);

        expect(result).toEqual([]);
    });

    it('should parse details from component page text into structured fields', () => {
        const html = `
          <html>
            <body>
              <div>Pré-Requisitos: MAT001</div>
              <div>Co-Requisitos: FIS001; FIS002</div>
              <div>Equivalências: MATX01, MATX02</div>
              <div>Ementa: Introdução aos sistemas computacionais.</div>
              <div>Objetivos: Compreender arquitetura e processos.</div>
              <div>Metodologia: Aulas expositivas e laboratório.</div>
              <div>Avaliação: Provas e projeto final.</div>
              <div>Teórica: 45h</div>
              <div>Prática: 15h</div>
              <div>Estágio: 0h</div>
              <div>Extensão: 10h</div>
            </body>
          </html>
        `;

        const $ = cheerio.load(html);
        const result = (service as any).parseSigaaComponentDetailPage($);

        expect(result).toEqual(
            expect.objectContaining({
                prerequeriments: 'MAT001',
                coRequisites: ['FIS001', 'FIS002'],
                equivalences: ['MATX01', 'MATX02'],
                syllabus: 'Introdução aos sistemas computacionais.',
                objective: 'Compreender arquitetura e processos.',
                methodology: 'Aulas expositivas e laboratório.',
                learningAssessment: 'Provas e projeto final.',
                workload: {
                    theoretical: 45,
                    practice: 15,
                    internship: 0,
                    extension: 10,
                },
            })
        );
    });

    it('should extract JSF detail action payload from listing row onclick', () => {
        const html = `
          <html>
            <body>
              <form id="formListagemComponentes" action="/sigaa/public/componentes/busca_componentes.jsf">
                <input type="hidden" name="javax.faces.ViewState" value="j_id1" />
              </form>
              <table>
                <tr class="linhaPar">
                  <td>MAT154</td>
                  <td>SISTEMAS OPERACIONAIS</td>
                  <td>DISCIPLINA</td>
                  <td>60h</td>
                  <td>
                    <a href="#" onclick="if(typeof jsfcljs == 'function'){jsfcljs(document.getElementById('formListagemComponentes'),{'formListagemComponentes:j_id_jsp_109_27':'formListagemComponentes:j_id_jsp_109_27','idComponente':'45325'},'');}return false">Visualizar programa</a>
                  </td>
                </tr>
              </table>
            </body>
          </html>
        `;

        const $ = cheerio.load(html);
        const result = (service as any).extractSigaaListRows($, 'department', AcademicLevel.GRADUATION);

        expect(result).toHaveLength(1);
        expect(result[0].detailActionUrl).toContain('/sigaa/public/componentes/busca_componentes.jsf');
        expect(result[0].detailActionPayload).toContain('idComponente=45325');
        expect(result[0].detailActionPayload).toContain('javax.faces.ViewState=j_id1');
    });

    it('should prefer the details JSF action over the program action when both are present', () => {
        const html = `
          <html>
            <body>
              <form id="formListagemComponentes" action="/sigaa/public/componentes/busca_componentes.jsf">
                <input type="hidden" name="javax.faces.ViewState" value="j_id1" />
              </form>
              <table>
                <tr class="linhaPar">
                  <td>MAT154</td>
                  <td>SISTEMAS OPERACIONAIS</td>
                  <td>DISCIPLINA</td>
                  <td>60h</td>
                  <td>
                    <a href="#" title="Detalhes do Componente Curricular" onclick="if(typeof jsfcljs == 'function'){jsfcljs(document.getElementById('formListagemComponentes'),{'formListagemComponentes:j_id_jsp_109_23':'formListagemComponentes:j_id_jsp_109_23','id':'45325','publico':'public'},'');}return false"><img src="/sigaa/img/view.gif" /></a>
                    <a href="#" title="Programa Atual do Componente" onclick="if(typeof jsfcljs == 'function'){jsfcljs(document.getElementById('formListagemComponentes'),{'formListagemComponentes:j_id_jsp_109_27':'formListagemComponentes:j_id_jsp_109_27','idComponente':'45325'},'');}return false"><img src="/sigaa/img/report.png" /></a>
                  </td>
                </tr>
              </table>
            </body>
          </html>
        `;

        const $ = cheerio.load(html);
        const result = (service as any).extractSigaaListRows($, 'department', AcademicLevel.GRADUATION);

        expect(result).toHaveLength(1);
        expect(result[0].detailActionPayload).toContain('id=45325');
        expect(result[0].detailActionPayload).not.toContain('idComponente=45325');
        expect(result[0].detailActionPayloadCandidates[0]).toContain('id=45325');
    });

      it('should parse detail labels with hyphen separators and label variants', () => {
        const fixturePath = path.resolve(__dirname, 'fixtures/sigaa/detail-variation-hyphen.html');
        const html = fs.readFileSync(fixturePath, 'utf-8');
        const $ = cheerio.load(html);

        const result = (service as any).parseSigaaComponentDetailPage($);

        expect(result).toEqual(
          expect.objectContaining({
            prerequeriments: 'MAT001, MAT002',
            coRequisites: ['FIS001', 'FIS002'],
            equivalences: ['MATX01', 'MATX02'],
            syllabus: 'Fundamentos de estruturas de dados.',
            objective: 'Compreender estruturas lineares e não lineares.',
            methodology: 'Aulas práticas e estudos dirigidos.',
            learningAssessment: 'Provas e listas.',
            workload: {
              theoretical: 45,
              practice: 15,
              internship: 0,
              extension: 12,
            },
          })
        );
      });

      it('should ignore co-requisite and equivalence fields without structured codes', () => {
        const fixturePath = path.resolve(__dirname, 'fixtures/sigaa/detail-variation-text-without-codes.html');
        const html = fs.readFileSync(fixturePath, 'utf-8');
        const $ = cheerio.load(html);

        const result = (service as any).parseSigaaComponentDetailPage($);

        expect(result).toEqual(
          expect.objectContaining({
            prerequeriments: 'NAO_SE_APLICA',
            coRequisites: [],
            equivalences: [],
            syllabus: 'Estudos avançados em computação.',
          })
        );
      });

      it('should parse detail fields from table layout', () => {
        const html = `
          <html>
            <body>
              <table>
                <tr><th>Pré-Requisitos</th><td>MAT101; MAT102</td></tr>
                <tr><th>Co-Requisitos</th><td>FIS201/FIS202</td></tr>
                <tr><th>Equivalências</th><td>MATX11, MATX12</td></tr>
                <tr><th>Ementa</th><td>Estruturas e algoritmos avançados.</td></tr>
                <tr><th>Objetivos</th><td>Aprofundar modelagem e desempenho.</td></tr>
                <tr><th>Metodologia</th><td>Aulas expositivas e laboratório guiado.</td></tr>
                <tr><th>Avaliação da Aprendizagem</th><td>Projeto, provas e seminário.</td></tr>
              </table>
              <p>Teórica: 60h</p>
              <p>Prática: 0h</p>
              <p>Estágio: 0h</p>
            </body>
          </html>
        `;

        const $ = cheerio.load(html);
        const result = (service as any).parseSigaaComponentDetailPage($);

        expect(result).toEqual(
          expect.objectContaining({
            prerequeriments: 'MAT101, MAT102',
            coRequisites: ['FIS201', 'FIS202'],
            equivalences: ['MATX11', 'MATX12'],
            syllabus: 'Estruturas e algoritmos avançados.',
            objective: 'Aprofundar modelagem e desempenho.',
            methodology: 'Aulas expositivas e laboratório guiado.',
            learningAssessment: 'Projeto, provas e seminário.',
          })
        );
      });

      it('should parse detail fields from hybrid blocks with multiple delimiters', () => {
        const html = `
          <html>
            <body>
              <div>Pré Requisitos: MAT301 | MAT302</div>
              <div>Co-Requisito - FIS301 e FIS302</div>
              <div>Equivalente(s): MATA01 / MATA02</div>
              <dl>
                <dt>Ementa</dt><dd>Computação distribuída e tolerância a falhas.</dd>
                <dt>Objetivo</dt><dd>Construir sistemas resilientes.</dd>
                <dt>Metodologia</dt><dd>Estudo de casos e práticas.</dd>
                <dt>Avaliacao</dt><dd>Trabalho final aplicado.</dd>
              </dl>
              <span>Teórica: 45h</span>
              <span>Prática: 15h</span>
              <span>Estágio: 0h</span>
              <span>Extensão: 8h</span>
            </body>
          </html>
        `;

        const $ = cheerio.load(html);
        const result = (service as any).parseSigaaComponentDetailPage($);

        expect(result).toEqual(
          expect.objectContaining({
            prerequeriments: 'MAT301, MAT302',
            coRequisites: ['FIS301', 'FIS302'],
            equivalences: ['MATA01', 'MATA02'],
            syllabus: 'Computação distribuída e tolerância a falhas.',
            objective: 'Construir sistemas resilientes.',
            methodology: 'Estudo de casos e práticas.',
            learningAssessment: 'Trabalho final aplicado.',
            workload: {
              theoretical: 45,
              practice: 15,
              internship: 0,
              extension: 8,
            },
          })
        );
      });
});
