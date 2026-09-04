import { Router } from 'express';

import { CourseController } from '../controllers/CourseController';
import { CreateCourseRequestDto, UpdateCourseRequestDto } from '../dtos/course';
import { ensureAdminAuthenticated, ensureAuthenticated } from '../middlewares/EnsureAuthenticated';
import { makeValidateBody } from '../middlewares/Validator';

const courseRouter = Router();
const courseController = new CourseController();

courseRouter.get('/', ensureAuthenticated, courseController.getCourses);
courseRouter.post('/', ensureAuthenticated, ensureAdminAuthenticated, makeValidateBody(CreateCourseRequestDto), courseController.createCourse);
courseRouter.put('/:id', ensureAuthenticated, ensureAdminAuthenticated, makeValidateBody(UpdateCourseRequestDto), courseController.updateCourse);
courseRouter.delete('/:id', ensureAuthenticated, ensureAdminAuthenticated, courseController.deleteCourse);

export { courseRouter };
