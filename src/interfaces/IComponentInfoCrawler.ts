import { AcademicLevel } from './AcademicLevel';

export interface IComponentCurriculumContextCrawler {
    curriculumCode: string;
    curriculumName: string;
    courseName?: string;
    implementationSemester?: string;
    recommendedPeriod?: number | null;
    isRequired: boolean;
    isActive: boolean;
    prerequeriments?: string;
    academicLevel?: AcademicLevel;
}

export interface IComponentInfoCrawler {
    code: string;
    name: string;
    department: string;
    semester: string; // 2007.2
    description: string;
    objective: string;
    syllabus: string;
    bibliography: string;
    referencesBasic?: string;
    referencesComplementary?: string;
    prerequeriments?: string;
    methodology?: string;
    modality?: string;
    learningAssessment?: string;
    academicLevel?: AcademicLevel;
    detailUrl?: string;
    detailActionUrl?: string;
    detailActionPayload?: string;
    detailActionPayloadCandidates?: string[];
    detailRequestCookie?: string;
    coRequisites?: string[];
    equivalences?: string[];
    curriculumContexts?: IComponentCurriculumContextCrawler[];
    workloadExtension?: number;
    workload?: {
        theoretical: number;
        practice: number;
        internship: number;
        extension?: number;
    }
}
