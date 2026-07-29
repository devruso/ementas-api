import { EntityRepository, Repository } from 'typeorm';

import { ComponentCurriculumContext } from '../entities/ComponentCurriculumContext';

@EntityRepository(ComponentCurriculumContext)
class ComponentCurriculumContextRepository extends Repository<ComponentCurriculumContext> { }

export { ComponentCurriculumContextRepository };
