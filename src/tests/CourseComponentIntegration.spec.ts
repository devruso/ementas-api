import { getCustomRepository } from 'typeorm';

import { AcademicLevel, POST_GRADUATION_ACADEMIC_LEVEL } from '../interfaces/AcademicLevel';
import { UserRole } from '../interfaces/UserRole';
import { ComponentRepository } from '../repositories/ComponentRepository';
import { ComponentDraftRepository } from '../repositories/ComponentDraftRepository';
import { CourseRepository } from '../repositories/CourseRepository';
import { UserRepository } from '../repositories/UserRepository';
import { ComponentService } from '../services/ComponentService';
import { CrawlerService } from '../services/CrawlerService';
import { CourseService } from '../services/CourseService';
import connection from './connection';

describe('Course and component integration', () => {
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
            name: 'Course Admin',
            email: 'course-admin@ufba.br',
            password: '123456',
            role: UserRole.ADMIN,
        }));
    };

    it('should create, search, update and delete courses without deleting disciplines', async () => {
        const courseService = new CourseService();
        const created = await courseService.createCourse('Curso de Testes', 'CT01');

        expect((await courseService.getCourses({ search: 'ct01' }))[0]).toEqual(expect.objectContaining({
            id: created.id,
            name: 'Curso de Testes',
            code: 'CT01',
        }));

        const updated = await courseService.updateCourse(created.id, {
            name: 'Curso de Testes Atualizado',
            code: 'CT02',
        });
        expect(updated).toEqual(expect.objectContaining({ name: 'Curso de Testes Atualizado', code: 'CT02' }));

        await courseService.deleteCourse(created.id);
        expect(await courseService.getCourses({ search: 'CT02' })).toHaveLength(0);
    });

    it('should create and link courses for manually created components', async () => {
        const admin = await createAdminUser();
        const componentService = new ComponentService();
        const courseService = new CourseService();
        const componentRepository = getCustomRepository(ComponentRepository);
        const componentDraftRepository = getCustomRepository(ComponentDraftRepository);
        const courseRepository = getCustomRepository(CourseRepository);

        await componentService.create(admin.id, {
            code: 'IC1010',
            name: 'INTEGRACAO DE CURSOS',
            department: 'Bacharelado em Ciencia da Computacao',
            semester: '2026.1',
            academicLevel: POST_GRADUATION_ACADEMIC_LEVEL,
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

        const course = await courseRepository.findOne({
            where: { name: 'Bacharelado em Ciência da Computação' },
        });
        const component = await componentRepository.findOne({
            where: { code: 'IC1010' },
            relations: ['courseRef'],
        });
        const draft = await componentDraftRepository.findOne({
            where: { code: 'IC1010' },
            relations: ['courseRef'],
        });

        expect(course).toBeTruthy();
        expect(component?.courseId).toBe(course?.id);
        expect(component?.courseRef?.name).toBe('Bacharelado em Ciência da Computação');
        expect(component?.academicLevel).toBe(POST_GRADUATION_ACADEMIC_LEVEL);
        expect(draft?.courseId).toBe(course?.id);

        const filtered = await componentService.getComponents({ course: course?.id });
        expect(filtered.map((item) => item.code)).toEqual(['IC1010']);

        const courses = await courseService.getCourses();
        expect(courses[0]).toEqual(expect.objectContaining({
            name: 'Bacharelado em Ciência da Computação',
            componentCount: 1,
            componentDraftCount: 1,
        }));
    });

    it('should create and link courses for crawler imported components', async () => {
        const admin = await createAdminUser();
        const crawlerService = new CrawlerService();
        const componentRepository = getCustomRepository(ComponentRepository);
        const componentDraftRepository = getCustomRepository(ComponentDraftRepository);
        const courseRepository = getCustomRepository(CourseRepository);

        await crawlerService.createComponent(admin.id, {
            code: 'IC2020',
            name: 'COMPONENTE IMPORTADO',
            department: 'Licenciatura em Computacao',
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

        const course = await courseRepository.findOne({
            where: { name: 'Licenciatura em Computação' },
        });
        const component = await componentRepository.findOne({
            where: { code: 'IC2020' },
            relations: ['courseRef'],
        });
        const draft = await componentDraftRepository.findOne({
            where: { code: 'IC2020' },
            relations: ['courseRef'],
        });

        expect(course).toBeTruthy();
        expect(component?.courseId).toBe(course?.id);
        expect(component?.courseRef?.name).toBe('Licenciatura em Computação');
        expect(draft?.courseId).toBe(course?.id);
    });
});
