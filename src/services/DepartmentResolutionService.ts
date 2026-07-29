import { getCustomRepository, QueryFailedError, Repository } from 'typeorm';

import { Department } from '../entities/Department';
import { DepartmentRepository } from '../repositories/DepartmentRepository';

type DepartmentAwarePayload = {
    department?: string | null;
    departmentId?: string | null;
};

class DepartmentResolutionService {
    private departmentRepository: Repository<Department>;

    constructor() {
        this.departmentRepository = getCustomRepository(DepartmentRepository);
    }

    normalizeDepartmentName(rawName?: string | null) {
        return String(rawName || '').replace(/\s+/g, ' ').trim();
    }

    normalizeDepartmentCode(rawCode?: string | null) {
        const normalized = String(rawCode || '').replace(/\s+/g, '').trim().toUpperCase();
        return normalized || null;
    }

    private isUniqueViolation(error: unknown) {
        if (!(error instanceof QueryFailedError)) {
            return false;
        }

        return (error.driverError as { code?: string })?.code === '23505';
    }

    async findDepartment(name?: string | null, code?: string | null) {
        const normalizedName = this.normalizeDepartmentName(name);
        const normalizedCode = this.normalizeDepartmentCode(code);

        if (!normalizedName && !normalizedCode) {
            return null;
        }

        const query = this.departmentRepository.createQueryBuilder('departments');

        if (normalizedName && normalizedCode) {
            query.where('LOWER(TRIM(departments.name)) = LOWER(TRIM(:name))', { name: normalizedName })
                .orWhere("LOWER(TRIM(COALESCE(departments.code, ''))) = LOWER(TRIM(:code))", { code: normalizedCode });
        } else if (normalizedName) {
            query.where('LOWER(TRIM(departments.name)) = LOWER(TRIM(:name))', { name: normalizedName });
        } else {
            query.where("LOWER(TRIM(COALESCE(departments.code, ''))) = LOWER(TRIM(:code))", { code: normalizedCode });
        }

        return query.getOne();
    }

    async resolveDepartment(name?: string | null, code?: string | null) {
        const normalizedName = this.normalizeDepartmentName(name);
        const normalizedCode = this.normalizeDepartmentCode(code);

        if (!normalizedName) {
            return null;
        }

        const existing = await this.findDepartment(normalizedName, normalizedCode);

        if (existing) {
            if (!existing.code && normalizedCode) {
                existing.code = normalizedCode;
                return this.departmentRepository.save(existing);
            }

            return existing;
        }

        try {
            return await this.departmentRepository.save(
                this.departmentRepository.create({
                    name: normalizedName,
                    code: normalizedCode,
                })
            );
        } catch (error) {
            if (this.isUniqueViolation(error)) {
                return this.findDepartment(normalizedName, normalizedCode);
            }

            throw error;
        }
    }

    async applyDepartment(payload: DepartmentAwarePayload) {
        if (payload.department === undefined && payload.departmentId === undefined) {
            return payload;
        }

        const department = payload.departmentId
            ? await this.departmentRepository.findOne({ where: { id: payload.departmentId } })
            : await this.resolveDepartment(payload.department);

        if (department) {
            payload.department = department.name;
            payload.departmentId = department.id;
            return payload;
        }

        const normalizedDepartment = this.normalizeDepartmentName(payload.department);
        payload.department = normalizedDepartment;
        payload.departmentId = normalizedDepartment ? payload.departmentId ?? null : null;

        return payload;
    }
}

export { DepartmentResolutionService };
