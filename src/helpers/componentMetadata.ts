import { AcademicLevel } from '../interfaces/AcademicLevel';
import { getCourseCatalogOptions } from './courseCatalog';
import { readSigaaSourceId } from './sigaaSourceConfig';

export const COMPONENT_MODALITY_OPTIONS = [
    { value: 'DISCIPLINA', label: 'Disciplina' },
    { value: 'ATIVIDADE', label: 'Atividade' },
    { value: 'MODULO', label: 'Módulo' },
] as const;

export const DEFAULT_COMPONENT_MODALITY = 'DISCIPLINA';

export const ACADEMIC_LEVEL_OPTIONS = [
    { value: AcademicLevel.GRADUATION, label: 'Graduação' },
    { value: AcademicLevel.MASTERS, label: 'Mestrado' },
    { value: AcademicLevel.DOCTORATE, label: 'Doutorado' },
] as const;

export const SIGAA_SOURCE_TYPE_OPTIONS = [
    { value: 'department', label: 'Departamento' },
    { value: 'program', label: 'Programa' },
] as const;

export const getComponentMetadata = () => ({
    defaults: {
        modality: DEFAULT_COMPONENT_MODALITY,
        academicLevel: AcademicLevel.GRADUATION,
    },
    modalities: COMPONENT_MODALITY_OPTIONS.map((option) => ({ ...option })),
    academicLevels: ACADEMIC_LEVEL_OPTIONS.map((option) => ({
        ...option,
        sigaaSourceId: readSigaaSourceId(option.value),
    })),
    sigaaSourceTypes: SIGAA_SOURCE_TYPE_OPTIONS.map((option) => ({ ...option })),
    courses: getCourseCatalogOptions(),
});
