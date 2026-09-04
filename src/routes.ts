import { Router } from 'express';

import { authRouter } from './routers/AuthRouter';
import { componentRouter } from './routers/ComponentRouter';
import { userRouter } from './routers/UserRouter';
import { statusRouter } from './routers/HealthCheck';
import { componentDraftRouter } from './routers/ComponentDraftRouter';
import { userInviteRouter } from './routers/UserInviteRouter';
import { departmentRouter } from './routers/DepartmentRouter';
import { courseRouter } from './routers/CourseRouter';

const router = Router();

router.use('/api/status', statusRouter);
router.use('/api/auth', authRouter);
router.use('/api/users', userRouter);
router.use('/api/invite', userInviteRouter);
router.use('/api/components', componentRouter);
router.use('/api/component-drafts', componentDraftRouter);
router.use('/api/departments', departmentRouter);
router.use('/api/courses', courseRouter);

router.use('/status', statusRouter);
router.use('/auth', authRouter);
router.use('/users', userRouter);
router.use('/invite', userInviteRouter);
router.use('/components', componentRouter);
router.use('/component-drafts', componentDraftRouter);
router.use('/departments', departmentRouter);
router.use('/courses', courseRouter);

router.use('/', authRouter);
router.use('/', componentRouter);
router.use('/', userRouter);

export { router };
