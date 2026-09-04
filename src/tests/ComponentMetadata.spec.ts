import supertest from 'supertest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const app = require('../app').app;

describe('Component metadata contract', () => {
    it('should expose canonical modalities, academic levels and courses', async () => {
        const response = await supertest(app).get('/api/components/metadata');

        expect(response.statusCode).toBe(200);
        expect(response.body.defaults).toEqual({
            modality: 'DISCIPLINA',
            academicLevel: 'graduacao',
        });
        expect(response.body.modalities).toEqual([
            { value: 'DISCIPLINA', label: 'Disciplina' },
            { value: 'ATIVIDADE', label: 'Atividade' },
            { value: 'MODULO', label: 'Módulo' },
        ]);
        expect(response.body.academicLevels).toEqual([
            { value: 'graduacao', label: 'Graduação', sigaaSourceId: '1114' },
            { value: 'pos_graduacao', label: 'Pós-Graduação', sigaaSourceId: '' },
        ]);
        expect(response.body.sigaaImportAcademicLevels).toEqual([
            { value: 'graduacao', label: 'Graduação', sigaaSourceId: '1114' },
            { value: 'mestrado', label: 'Mestrado', sigaaSourceId: '1820' },
            { value: 'doutorado', label: 'Doutorado', sigaaSourceId: '43753' },
        ]);
        expect(response.body.sigaaSourceTypes).toEqual([
            { value: 'department', label: 'Departamento' },
            { value: 'program', label: 'Programa' },
        ]);
        expect(response.body.courses).toEqual(expect.arrayContaining([
            expect.objectContaining({
                key: 'INFORMATION_SYSTEMS_BACHELOR',
                value: 'Bacharelado em Sistemas de Informação',
            }),
        ]));
    });
});
