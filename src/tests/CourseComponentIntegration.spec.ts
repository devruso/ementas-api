import { getCustomRepository } from 'typeorm';

import { AcademicLevel } from '../interfaces/AcademicLevel';
import { UserRole } from '../interfaces/UserRole';
import { ComponentRepository } from '../repositories/ComponentRepository';
import { ComponentDraftRepository } from '../repositories/ComponentDraftRepository';
import { DepartmentRepository } from '../repositories/DepartmentRepository';
import { UserRepository } from '../repositories/UserRepository';
import { ComponentService } from '../services/ComponentService';
import { CrawlerService } from '../services/CrawlerService';
import { DepartmentService } from '../services/DepartmentService';
import connection from './connection';

describe('Department and component integration', () => {
    beforeAll(async () => {
        await connection.create();
    });

    afterAll(async () => {
        await connection.close();
    });

    beforeEach(async () => {
        await connection.clear();
    });

    const createAdminUser = async () => {
        const userRepository = getCustomRepository(UserRepository);

        return userRepository.save(userRepository.create({
            name: 'Department Admin',
            email: 'department-admin@ufba.br',
            password: '123456',
            role: UserRole.ADMIN,
        }));
    };

    it('should create and link departments for manually created components', async () => {
        const admin = await createAdminUser();
        const componentService = new ComponentService();
        const departmentService = new DepartmentService();
        const componentRepository = getCustomRepository(ComponentRepository);
        const componentDraftRepository = getCustomRepository(ComponentDraftRepository);
        const departmentRepository = getCustomRepository(DepartmentRepository);

        await componentService.create(admin.id, {
            code: 'IC1010',
            name: 'INTEGRACAO DE DEPARTAMENTOS',
            department: 'Departamento de Ciencia da Computacao',
            semester: '2026.1',
            academicLevel: AcademicLevel.GRADUATION,
            modality: 'DISCIPLINA',
            program: 'Conteudo',
            objective: 'Objetivo',
            syllabus: 'Ementa',
            bibliography: 'Bibliografia',
            referencesBasic: 'Bibliografia',
            referencesComplementary: '',
            prerequeriments: 'NAO_SE_APLICA',
            methodology: 'Metodologia',
            learningAssessment: 'Avaliacao',
            workload: { studentTheory: 60 },
        });

        const department = await departmentRepository.findOne({
            where: { name: 'Departamento de Ciencia da Computacao' },
        });
        const component = await componentRepository.findOne({
            where: { code: 'IC1010' },
            relations: ['departmentRef'],
        });
        const draft = await componentDraftRepository.findOne({
            where: { code: 'IC1010' },
            relations: ['departmentRef'],
        });

        expect(department).toBeTruthy();
        expect(component?.departmentId).toBe(department?.id);
        expect(component?.departmentRef?.name).toBe('Departamento de Ciencia da Computacao');
        expect(draft?.departmentId).toBe(department?.id);

        const filtered = await componentService.getComponents({ department: department?.id });
        expect(filtered.map((item) => item.code)).toEqual(['IC1010']);

        const departments = await departmentService.getDepartments();
        expect(departments[0]).toEqual(expect.objectContaining({
            name: 'Departamento de Ciencia da Computacao',
            componentCount: 1,
            componentDraftCount: 1,
        }));
    });

    it('should create and link departments for crawler imported components', async () => {
        const admin = await createAdminUser();
        const crawlerService = new CrawlerService();
        const componentRepository = getCustomRepository(ComponentRepository);
        const componentDraftRepository = getCustomRepository(ComponentDraftRepository);
        const departmentRepository = getCustomRepository(DepartmentRepository);

        await crawlerService.createComponent(admin.id, {
            code: 'IC2020',
            name: 'COMPONENTE IMPORTADO',
            department: 'Instituto de Computacao',
            semester: '2026.1',
            academicLevel: AcademicLevel.GRADUATION,
            modality: 'DISCIPLINA',
            description: 'Conteudo',
            objective: 'Objetivo',
            syllabus: 'Ementa',
            bibliography: 'Bibliografia',
            prerequeriments: 'NAO_SE_APLICA',
            methodology: 'Metodologia',
            learningAssessment: 'Avaliacao',
            workload: { theoretical: 60, practice: 0, internship: 0 },
        });

        const department = await departmentRepository.findOne({
            where: { name: 'Instituto de Computacao' },
        });
        const component = await componentRepository.findOne({
            where: { code: 'IC2020' },
            relations: ['departmentRef'],
        });
        const draft = await componentDraftRepository.findOne({
            where: { code: 'IC2020' },
            relations: ['departmentRef'],
        });

        expect(department).toBeTruthy();
        expect(component?.departmentId).toBe(department?.id);
        expect(component?.departmentRef?.name).toBe('Instituto de Computacao');
        expect(draft?.departmentId).toBe(department?.id);
    });
});
