import { Request, Response } from 'express';

import { CreateCourseRequestDto, UpdateCourseRequestDto } from '../dtos/course';
import { paginate } from '../helpers/paginate';
import { CourseService } from '../services/CourseService';

class CourseController {
    async getCourses(request: Request, response: Response) {
        const search = String(request.query.search ?? '').trim() || undefined;
        const sortBy = String(request.query.sortBy ?? '').trim() || undefined;
        const sortOrder = String(request.query.sortOrder ?? 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        const page = parseInt(String(request.query.page)) || 0;
        const limit = parseInt(String(request.query.limit)) || 10;
        const courses = await new CourseService().getCourses({ search, sortBy, sortOrder });
        return response.status(200).json(paginate(courses, { page, limit, search, sortBy, sortOrder }));
    }

    async createCourse(request: Request, response: Response) {
        const { name, code } = request.body as CreateCourseRequestDto;
        return response.status(201).json(await new CourseService().createCourse(name, code));
    }

    async updateCourse(request: Request, response: Response) {
        const { name, code } = request.body as UpdateCourseRequestDto;
        return response.status(200).json(await new CourseService().updateCourse(request.params.id, { name, code }));
    }

    async deleteCourse(request: Request, response: Response) {
        await new CourseService().deleteCourse(request.params.id);
        return response.status(200).json({ message: 'Curso removido com sucesso.' });
    }
}

export { CourseController };
