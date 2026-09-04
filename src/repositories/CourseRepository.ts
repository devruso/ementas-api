import { EntityRepository, Repository } from 'typeorm';

import { Course } from '../entities/Course';

@EntityRepository(Course)
class CourseRepository extends Repository<Course> { }

export { CourseRepository };
