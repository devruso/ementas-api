import { getCustomRepository } from 'typeorm';

import { Department } from '../entities/Department';
import { AppError } from '../errors/AppError';
import { ComponentRepository } from '../repositories/ComponentRepository';
import { ComponentDraftRepository } from '../repositories/ComponentDraftRepository';
import { DepartmentRepository } from '../repositories/DepartmentRepository';

type DepartmentSortBy = 'name' | 'code' | 'createdAt' | 'updatedAt';

class DepartmentService {
    private departmentRepository = getCustomRepository(DepartmentRepository);

    private componentRepository = getCustomRepository(ComponentRepository);

    private componentDraftRepository = getCustomRepository(ComponentDraftRepository);

    private normalizeDepartmentName(rawName: string) {
        return rawName.replace(/\s+/g, ' ').trim();
    }

    private normalizeDepartmentCode(rawCode?: string) {
        const normalized = String(rawCode || '').trim().toUpperCase();
        return normalized || null;
    }

    private async ensureDepartmentUniqueness(name: string, code?: string | null, ignoreId?: string) {
        const duplicatedName = await this.departmentRepository
            .createQueryBuilder('departments')
            .where('LOWER(TRIM(departments.name)) = LOWER(TRIM(:name))', { name })
            .andWhere(ignoreId ? 'departments.id != :ignoreId' : '1=1', { ignoreId })
            .getOne();

        if (duplicatedName) {
            throw new AppError('Já existe um departamento com este nome.', 400);
        }

        if (code) {
            const duplicatedCode = await this.departmentRepository
                .createQueryBuilder('departments')
                .where("LOWER(TRIM(COALESCE(departments.code, ''))) = LOWER(TRIM(:code))", { code })
                .andWhere(ignoreId ? 'departments.id != :ignoreId' : '1=1', { ignoreId })
                .getOne();

            if (duplicatedCode) {
                throw new AppError('Já existe um departamento com este código.', 400);
            }
        }
    }

    private async syncDepartmentRelations(department: Department, previousName?: string) {
        const previous = previousName ? previousName.toLowerCase() : null;

        await this.componentRepository
            .createQueryBuilder()
            .update('components')
            .set({
                departmentId: department.id,
                department: department.name,
            })
            .where('department_id = :departmentId', { departmentId: department.id })
            .orWhere('LOWER(TRIM(department)) = LOWER(TRIM(:name))', { name: department.name })
            .orWhere(previous ? 'LOWER(TRIM(department)) = :previous' : '1=0', { previous })
            .execute();

        await this.componentDraftRepository
            .createQueryBuilder()
            .update('component_drafts')
            .set({
                departmentId: department.id,
                department: department.name,
            })
            .where('department_id = :departmentId', { departmentId: department.id })
            .orWhere('LOWER(TRIM(department)) = LOWER(TRIM(:name))', { name: department.name })
            .orWhere(previous ? 'LOWER(TRIM(department)) = :previous' : '1=0', { previous })
            .execute();
    }

    async getDepartments(options?: {
        search?: string;
        sortBy?: string;
        sortOrder?: 'ASC' | 'DESC';
    }) {
        const normalizedSearch = String(options?.search || '').trim().toLowerCase();
        const sortMap: Record<DepartmentSortBy, string> = {
            name: 'departments.name',
            code: 'departments.code',
            createdAt: 'departments.createdAt',
            updatedAt: 'departments.updatedAt',
        };
        const sortBy = (options?.sortBy as DepartmentSortBy) || 'name';
        const sortColumn = sortMap[sortBy] || sortMap.name;
        const sortOrder = options?.sortOrder === 'DESC' ? 'DESC' : 'ASC';

        const query = this.departmentRepository
            .createQueryBuilder('departments');

        if (normalizedSearch) {
            query.where('LOWER(departments.name) LIKE :search', { search: `%${normalizedSearch}%` })
                .orWhere("LOWER(COALESCE(departments.code, '')) LIKE :search", { search: `%${normalizedSearch}%` });
        }

        return query
            .orderBy(sortColumn, sortOrder)
            .addOrderBy('departments.createdAt', 'DESC')
            .getMany();
    }

    async createDepartment(name: string, code?: string) {
        const normalizedName = this.normalizeDepartmentName(name);
        const normalizedCode = this.normalizeDepartmentCode(code);

        await this.ensureDepartmentUniqueness(normalizedName, normalizedCode);

        const department = await this.departmentRepository.save(
            this.departmentRepository.create({
                name: normalizedName,
                code: normalizedCode,
            })
        );

        await this.syncDepartmentRelations(department);

        return department;
    }

    async updateDepartment(departmentId: string, payload: { name: string; code?: string }) {
        const department = await this.departmentRepository.findOne({ where: { id: departmentId } });

        if (!department) {
            throw new AppError('Departamento não encontrado.', 404);
        }

        const normalizedName = this.normalizeDepartmentName(payload.name);
        const normalizedCode = this.normalizeDepartmentCode(payload.code);

        await this.ensureDepartmentUniqueness(normalizedName, normalizedCode, departmentId);

        const previousName = department.name;

        department.name = normalizedName;
        department.code = normalizedCode;

        const updatedDepartment = await this.departmentRepository.save(department);

        await this.syncDepartmentRelations(updatedDepartment, previousName);

        return updatedDepartment;
    }

    async deleteDepartment(departmentId: string) {
        const department = await this.departmentRepository.findOne({ where: { id: departmentId } });

        if (!department) {
            throw new AppError('Departamento não encontrado.', 404);
        }

        await this.componentRepository
            .createQueryBuilder()
            .update('components')
            .set({ departmentId: null })
            .where('department_id = :departmentId', { departmentId })
            .execute();

        await this.componentDraftRepository
            .createQueryBuilder()
            .update('component_drafts')
            .set({ departmentId: null })
            .where('department_id = :departmentId', { departmentId })
            .execute();

        await this.departmentRepository.delete({ id: departmentId });
    }
}

export { DepartmentService };