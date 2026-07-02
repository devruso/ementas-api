import { Request, Response } from 'express';

import { paginate } from '../helpers/paginate';
import { CreateDepartmentRequestDto, UpdateDepartmentRequestDto } from '../dtos/department';
import { DepartmentService } from '../services/DepartmentService';

class DepartmentController {
    async getDepartments(request: Request, response: Response) {
        const departmentService = new DepartmentService();

        const search = String(request.query.search ?? '').trim() || undefined;
        const sortBy = String(request.query.sortBy ?? '').trim() || undefined;
        const sortOrder = String(request.query.sortOrder ?? 'ASC').toUpperCase() === 'DESC'
            ? 'DESC'
            : 'ASC';
        const page = parseInt(String(request.query.page)) || 0;
        const limit = parseInt(String(request.query.limit)) || 10;

        const departments = await departmentService.getDepartments({
            search,
            sortBy,
            sortOrder,
        });

        return response.status(200).json(paginate(departments, { page, limit, search, sortBy, sortOrder }));
    }

    async createDepartment(request: Request, response: Response) {
        const departmentService = new DepartmentService();
        const { name, code } = request.body as CreateDepartmentRequestDto;

        const department = await departmentService.createDepartment(name, code);
        return response.status(201).json(department);
    }

    async updateDepartment(request: Request, response: Response) {
        const departmentService = new DepartmentService();
        const { id } = request.params;
        const { name, code } = request.body as UpdateDepartmentRequestDto;

        const department = await departmentService.updateDepartment(id, { name, code });
        return response.status(200).json(department);
    }

    async deleteDepartment(request: Request, response: Response) {
        const departmentService = new DepartmentService();
        const { id } = request.params;

        await departmentService.deleteDepartment(id);
        return response.status(200).json({ message: 'Department has been deleted.' });
    }
}

export { DepartmentController };