import { Router } from 'express';

import { DepartmentController } from '../controllers/DepartmentController';
import { CreateDepartmentRequestDto, UpdateDepartmentRequestDto } from '../dtos/department';
import { ensureAdminAuthenticated, ensureAuthenticated } from '../middlewares/EnsureAuthenticated';
import { makeValidateBody } from '../middlewares/Validator';

const departmentRouter = Router();
const departmentController = new DepartmentController();

departmentRouter.get('/', ensureAuthenticated, departmentController.getDepartments);

departmentRouter.post(
    '/',
    ensureAuthenticated,
    ensureAdminAuthenticated,
    makeValidateBody(CreateDepartmentRequestDto),
    departmentController.createDepartment
);

departmentRouter.put(
    '/:id',
    ensureAuthenticated,
    ensureAdminAuthenticated,
    makeValidateBody(UpdateDepartmentRequestDto),
    departmentController.updateDepartment
);

departmentRouter.delete('/:id', ensureAuthenticated, ensureAdminAuthenticated, departmentController.deleteDepartment);

export { departmentRouter };
