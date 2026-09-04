import { getCustomRepository } from 'typeorm';

import { Course } from '../entities/Course';
import { AppError } from '../errors/AppError';
import { ComponentRepository } from '../repositories/ComponentRepository';
import { ComponentDraftRepository } from '../repositories/ComponentDraftRepository';
import { CourseRepository } from '../repositories/CourseRepository';

type CourseSortBy = 'name' | 'code' | 'createdAt' | 'updatedAt';

class CourseService {
    private courseRepository = getCustomRepository(CourseRepository);

    private componentRepository = getCustomRepository(ComponentRepository);

    private componentDraftRepository = getCustomRepository(ComponentDraftRepository);

    private normalizeName(rawName: string) {
        return rawName.replace(/\s+/g, ' ').trim();
    }

    private normalizeCode(rawCode?: string) {
        const normalized = String(rawCode || '').replace(/\s+/g, '').trim().toUpperCase();
        return normalized || null;
    }

    private async ensureUniqueness(name: string, code?: string | null, ignoreId?: string) {
        const duplicatedName = await this.courseRepository
            .createQueryBuilder('courses')
            .where('LOWER(TRIM(courses.name)) = LOWER(TRIM(:name))', { name })
            .andWhere(ignoreId ? 'courses.id != :ignoreId' : '1=1', { ignoreId })
            .getOne();

        if (duplicatedName) {
            throw new AppError('Já existe um curso com este nome.', 400);
        }

        if (code) {
            const duplicatedCode = await this.courseRepository
                .createQueryBuilder('courses')
                .where('LOWER(TRIM(COALESCE(courses.code, \'\'))) = LOWER(TRIM(:code))', { code })
                .andWhere(ignoreId ? 'courses.id != :ignoreId' : '1=1', { ignoreId })
                .getOne();

            if (duplicatedCode) {
                throw new AppError('Já existe um curso com este código.', 400);
            }
        }
    }

    private async syncRelations(course: Course, previousName?: string) {
        const previous = previousName?.trim().toLowerCase() || null;
        const code = course.code?.trim().toLowerCase() || null;

        await this.componentRepository
            .createQueryBuilder()
            .update('components')
            .set({ courseId: course.id, department: course.name })
            .where('course_id = :courseId', { courseId: course.id })
            .orWhere('LOWER(TRIM(department)) = LOWER(TRIM(:name))', { name: course.name })
            .orWhere(code ? 'LOWER(TRIM(department)) = :code' : '1=0', { code })
            .orWhere(previous ? 'LOWER(TRIM(department)) = :previous' : '1=0', { previous })
            .execute();

        await this.componentDraftRepository
            .createQueryBuilder()
            .update('component_drafts')
            .set({ courseId: course.id, department: course.name })
            .where('course_id = :courseId', { courseId: course.id })
            .orWhere('LOWER(TRIM(department)) = LOWER(TRIM(:name))', { name: course.name })
            .orWhere(code ? 'LOWER(TRIM(department)) = :code' : '1=0', { code })
            .orWhere(previous ? 'LOWER(TRIM(department)) = :previous' : '1=0', { previous })
            .execute();
    }

    async getCourses(options?: { search?: string; sortBy?: string; sortOrder?: 'ASC' | 'DESC' }) {
        const search = String(options?.search || '').trim().toLowerCase();
        const sortMap: Record<CourseSortBy, string> = {
            name: 'courses.name',
            code: 'courses.code',
            createdAt: 'courses.createdAt',
            updatedAt: 'courses.updatedAt',
        };
        const sortColumn = sortMap[(options?.sortBy as CourseSortBy) || 'name'] || sortMap.name;
        const sortOrder = options?.sortOrder === 'DESC' ? 'DESC' : 'ASC';
        const query = this.courseRepository
            .createQueryBuilder('courses')
            .loadRelationCountAndMap('courses.componentCount', 'courses.components')
            .loadRelationCountAndMap('courses.componentDraftCount', 'courses.componentDrafts');

        if (search) {
            query.where('LOWER(courses.name) LIKE :search', { search: `%${search}%` })
                .orWhere('LOWER(COALESCE(courses.code, \'\')) LIKE :search', { search: `%${search}%` });
        }

        return query.orderBy(sortColumn, sortOrder).addOrderBy('courses.createdAt', 'DESC').getMany();
    }

    async createCourse(name: string, code?: string) {
        const normalizedName = this.normalizeName(name);
        const normalizedCode = this.normalizeCode(code);
        await this.ensureUniqueness(normalizedName, normalizedCode);

        const course = await this.courseRepository.save(this.courseRepository.create({
            name: normalizedName,
            code: normalizedCode,
        }));
        await this.syncRelations(course);
        return course;
    }

    async updateCourse(courseId: string, payload: { name: string; code?: string }) {
        const course = await this.courseRepository.findOne({ where: { id: courseId } });
        if (!course) {
            throw new AppError('Curso não encontrado.', 404);
        }

        const normalizedName = this.normalizeName(payload.name);
        const normalizedCode = this.normalizeCode(payload.code);
        await this.ensureUniqueness(normalizedName, normalizedCode, courseId);

        const previousName = course.name;
        course.name = normalizedName;
        course.code = normalizedCode;
        const updatedCourse = await this.courseRepository.save(course);
        await this.syncRelations(updatedCourse, previousName);
        return updatedCourse;
    }

    async deleteCourse(courseId: string) {
        const course = await this.courseRepository.findOne({ where: { id: courseId } });
        if (!course) {
            throw new AppError('Curso não encontrado.', 404);
        }

        await this.componentRepository.createQueryBuilder().update('components')
            .set({ courseId: null, department: '' }).where('course_id = :courseId', { courseId }).execute();
        await this.componentDraftRepository.createQueryBuilder().update('component_drafts')
            .set({ courseId: null, department: '' }).where('course_id = :courseId', { courseId }).execute();
        await this.courseRepository.delete({ id: courseId });
    }
}

export { CourseService };
