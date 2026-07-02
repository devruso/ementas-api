import { EntityRepository, Repository } from 'typeorm';

import { Department } from '../entities/Department';

@EntityRepository(Department)
class DepartmentRepository extends Repository<Department> { }

export { DepartmentRepository };