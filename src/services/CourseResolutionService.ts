import { getCustomRepository, QueryFailedError, Repository } from 'typeorm';

import { Course } from '../entities/Course';
import { AppError } from '../errors/AppError';
import { CourseRepository } from '../repositories/CourseRepository';
import { normalizeCourseNameFromSource } from '../helpers/courseCatalog';

type CourseAwarePayload = {
    department?: string | null;
    courseId?: string | null;
};

class CourseResolutionService {
    private courseRepository: Repository<Course>;

    constructor() {
        this.courseRepository = getCustomRepository(CourseRepository);
    }

    normalizeCourseName(rawName?: string | null) {
        return normalizeCourseNameFromSource(rawName).replace(/\s+/g, ' ').trim();
    }

    normalizeCourseCode(rawCode?: string | null) {
        const normalized = String(rawCode || '').replace(/\s+/g, '').trim().toUpperCase();
        return normalized || null;
    }

    private isUniqueViolation(error: unknown) {
        return error instanceof QueryFailedError
            && (error.driverError as { code?: string })?.code === '23505';
    }

    async findCourse(name?: string | null, code?: string | null) {
        const normalizedName = this.normalizeCourseName(name);
        const normalizedCode = this.normalizeCourseCode(code);

        if (!normalizedName && !normalizedCode) {
            return null;
        }

        const query = this.courseRepository.createQueryBuilder('courses');

        if (normalizedName && normalizedCode) {
            query.where('LOWER(TRIM(courses.name)) = LOWER(TRIM(:name))', { name: normalizedName })
                .orWhere('LOWER(TRIM(COALESCE(courses.code, \'\'))) = LOWER(TRIM(:code))', { code: normalizedCode });
        } else if (normalizedName) {
            query.where('LOWER(TRIM(courses.name)) = LOWER(TRIM(:name))', { name: normalizedName });
        } else {
            query.where('LOWER(TRIM(COALESCE(courses.code, \'\'))) = LOWER(TRIM(:code))', { code: normalizedCode });
        }

        return query.getOne();
    }

    async resolveCourse(name?: string | null, code?: string | null) {
        const normalizedName = this.normalizeCourseName(name);
        const normalizedCode = this.normalizeCourseCode(code);

        if (!normalizedName) {
            return null;
        }

        const existing = await this.findCourse(normalizedName, normalizedCode);
        if (existing) {
            if (!existing.code && normalizedCode) {
                existing.code = normalizedCode;
                return this.courseRepository.save(existing);
            }

            return existing;
        }

        try {
            return await this.courseRepository.save(this.courseRepository.create({
                name: normalizedName,
                code: normalizedCode,
            }));
        } catch (error) {
            if (this.isUniqueViolation(error)) {
                return this.findCourse(normalizedName, normalizedCode);
            }

            throw error;
        }
    }

    async applyCourse(payload: CourseAwarePayload) {
        if (payload.department === undefined && payload.courseId === undefined) {
            return payload;
        }

        const course = payload.courseId
            ? await this.courseRepository.findOne({ where: { id: payload.courseId } })
            : await this.resolveCourse(payload.department);

        if (payload.courseId && !course) {
            throw new AppError('Curso não encontrado.', 404);
        }

        if (course) {
            payload.department = course.name;
            payload.courseId = course.id;
            return payload;
        }

        const normalizedCourse = this.normalizeCourseName(payload.department);
        payload.department = normalizedCourse;
        payload.courseId = normalizedCourse ? payload.courseId ?? null : null;
        return payload;
    }
}

export { CourseResolutionService };
