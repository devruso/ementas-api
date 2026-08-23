import { AcademicLevel } from '../interfaces/AcademicLevel';

const DEFAULT_SIGAA_SOURCE_IDS: Record<AcademicLevel, string> = {
    [AcademicLevel.GRADUATION]: '1114',
    [AcademicLevel.MASTERS]: '1820',
    [AcademicLevel.DOCTORATE]: '43753',
};

export const readSigaaSourceId = (level?: AcademicLevel) => {
    const globalSourceId = String(process.env.BOOTSTRAP_SIGAA_SOURCE_ID || '').trim();

    if (!level) {
        return globalSourceId;
    }

    const levelMap: Record<AcademicLevel, string> = {
        [AcademicLevel.GRADUATION]: String(process.env.BOOTSTRAP_SIGAA_SOURCE_ID_GRADUACAO || '').trim(),
        [AcademicLevel.MASTERS]: String(process.env.BOOTSTRAP_SIGAA_SOURCE_ID_MESTRADO || '').trim(),
        [AcademicLevel.DOCTORATE]: String(process.env.BOOTSTRAP_SIGAA_SOURCE_ID_DOUTORADO || '').trim(),
    };

    return levelMap[level] || globalSourceId || DEFAULT_SIGAA_SOURCE_IDS[level];
};
