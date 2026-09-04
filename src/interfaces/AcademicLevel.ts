export enum AcademicLevel {
    GRADUATION = 'graduacao',
    MASTERS = 'mestrado',
    DOCTORATE = 'doutorado'
}

export const POST_GRADUATION_ACADEMIC_LEVEL = 'pos_graduacao' as const;

export type ComponentAcademicLevel = AcademicLevel | typeof POST_GRADUATION_ACADEMIC_LEVEL;

export const COMPONENT_ACADEMIC_LEVELS = [
    ...Object.values(AcademicLevel),
    POST_GRADUATION_ACADEMIC_LEVEL,
] as const;
