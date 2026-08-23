export const COURSE_CATALOG = {
    COMPUTER_SCIENCE_BACHELOR: 'Bacharelado em Ci\u00eancia da Computa\u00e7\u00e3o',
    INFORMATION_SYSTEMS_BACHELOR: 'Bacharelado em Sistemas de Informa\u00e7\u00e3o',
    COMPUTING_TEACHING_DEGREE: 'Licenciatura em Computa\u00e7\u00e3o',
    PGCOMP: 'Programa de P\u00f3s-Gradua\u00e7\u00e3o em Ci\u00eancia da Computa\u00e7\u00e3o',
    PMCC: 'Programa de P\u00f3s-Gradua\u00e7\u00e3o em Mecatr\u00f4nica',
} as const;

const normalizeForMatch = (value?: string | null) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

const normalizeForAccentInsensitiveSql = (value?: string | null) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const courseAliases: Record<string, string[]> = {
    [COURSE_CATALOG.COMPUTER_SCIENCE_BACHELOR]: [
        COURSE_CATALOG.COMPUTER_SCIENCE_BACHELOR,
        'COLEGIADO DO CURSO DE GRADUA\u00c7\u00c3O EM CI\u00caNCIA DA COMPUTA\u00c7\u00c3O/IC',
        'COLEGIADO DO CURSO DE GRADUACAO EM CIENCIA DA COMPUTACAO/IC',
    ],
    [COURSE_CATALOG.INFORMATION_SYSTEMS_BACHELOR]: [
        COURSE_CATALOG.INFORMATION_SYSTEMS_BACHELOR,
        'COLEGIADO DO CURSO DE GRADUA\u00c7\u00c3O EM SISTEMAS DE INFORMA\u00c7\u00c3O/IC',
        'COLEGIADO DO CURSO DE GRADUACAO EM SISTEMAS DE INFORMACAO/IC',
    ],
    [COURSE_CATALOG.COMPUTING_TEACHING_DEGREE]: [
        COURSE_CATALOG.COMPUTING_TEACHING_DEGREE,
        'COLEGIADO DO CURSO DE LICENCIATURA EM COMPUTA\u00c7\u00c3O/IC',
        'COLEGIADO DO CURSO DE LICENCIATURA EM COMPUTACAO/IC',
    ],
    [COURSE_CATALOG.PGCOMP]: [
        COURSE_CATALOG.PGCOMP,
        'PROGRAMA DE P\u00d3S-GRADUA\u00c7\u00c3O EM CI\u00caNCIA DA COMPUTA\u00c7\u00c3O',
        'PROGRAMA DE POS-GRADUACAO EM CIENCIA DA COMPUTACAO',
        'PROGRAMA DE P\u00d3S-GRADUA\u00c7\u00c3O EM CI\u00caNCIA DA COMPUTA\u00c7\u00c3O (PGCOMP)',
        'PROGRAMA DE POS-GRADUACAO EM CIENCIA DA COMPUTACAO (PGCOMP)',
        'PGCOMP',
        'PGCOMP/IC',
        'Programa SIGAA',
    ],
    [COURSE_CATALOG.PMCC]: [
        COURSE_CATALOG.PMCC,
        'PROGRAMA DE P\u00d3S-GRADUA\u00c7\u00c3O EM MECATR\u00d4NICA',
        'PROGRAMA DE POS-GRADUACAO EM MECATRONICA',
        'PROGRAMA DE P\u00d3S-GRADUA\u00c7\u00c3O EM MECATR\u00d4NICA (PMCC)',
        'PROGRAMA DE POS-GRADUACAO EM MECATRONICA (PMCC)',
        'PROGRAMA DE P\u00d3S-GRADUA\u00c7\u00c3O EM CI\u00caNCIA DA COMPUTA\u00c7\u00c3O (PMCC)',
        'PROGRAMA DE POS-GRADUACAO EM CIENCIA DA COMPUTACAO (PMCC)',
        'PROGRAMA MULTIDISCIPLINAR EM CI\u00caNCIA DA COMPUTA\u00c7\u00c3O',
        'PROGRAMA MULTIDISCIPLINAR EM CIENCIA DA COMPUTACAO',
        'PMCC',
    ],
};

export const getCourseCatalogOptions = () => Object.entries(COURSE_CATALOG).map(([ key, value ]) => ({
    key,
    value,
    label: value,
    aliases: Array.from(new Set(courseAliases[value] || [ value ])),
}));

const normalizedAliasToCourse = new Map<string, string>(
    Object.entries(courseAliases)
        .flatMap(([ courseName, aliases ]) => aliases.map(
            (alias) => [ normalizeForMatch(alias), courseName ] as [ string, string ]
        ))
);

export const normalizeCourseNameFromSource = (value?: string | null) => {
    const cleanValue = String(value || '').replace(/\s+/g, ' ').trim();
    const normalized = normalizeForMatch(cleanValue);

    if (!normalized) {
        return '';
    }

    const directMatch = normalizedAliasToCourse.get(normalized);

    if (directMatch) {
        return directMatch;
    }

    if (
        normalized.includes('PMCC')
        || normalized.includes('MECATRONICA')
        || (normalized.includes('MULTIDISCIPLINAR') && normalized.includes('CIENCIA DA COMPUTACAO'))
    ) {
        return COURSE_CATALOG.PMCC;
    }

    if (
        normalized.includes('PGCOMP')
        || (normalized.includes('POS GRADUACAO') && normalized.includes('CIENCIA DA COMPUTACAO'))
    ) {
        return COURSE_CATALOG.PGCOMP;
    }

    if (normalized.includes('SISTEMAS DE INFORMACAO')) {
        return COURSE_CATALOG.INFORMATION_SYSTEMS_BACHELOR;
    }

    if (normalized.includes('LICENCIATURA') && normalized.includes('COMPUTACAO')) {
        return COURSE_CATALOG.COMPUTING_TEACHING_DEGREE;
    }

    if (
        normalized.includes('BACHARELADO EM CIENCIA DA COMPUTACAO')
        || (
            normalized.includes('COLEGIADO')
            && normalized.includes('GRADUACAO')
            && normalized.includes('CIENCIA DA COMPUTACAO')
        )
    ) {
        return COURSE_CATALOG.COMPUTER_SCIENCE_BACHELOR;
    }

    return cleanValue;
};

export const getCourseFilterAliases = (courseName?: string | null) => {
    const canonicalName = normalizeCourseNameFromSource(courseName);
    const aliases = courseAliases[canonicalName] || [];

    return Array.from(new Set([ canonicalName, ...aliases ]))
        .filter(Boolean)
        .map(normalizeForAccentInsensitiveSql);
};

export const normalizeProgrammaticSemester = (value?: string | null) => {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();

    if (!normalized) {
        return '';
    }

    const separatedMatch = normalized.match(/\b((?:19|20)\d{2})\s*[.\-/]\s*([12])\b/);
    if (separatedMatch?.[1] && separatedMatch?.[2]) {
        return `${separatedMatch[1]}.${separatedMatch[2]}`;
    }

    const compactMatch = normalized.match(/\b((?:19|20)\d{2})([12])\b/);
    if (compactMatch?.[1] && compactMatch?.[2]) {
        return `${compactMatch[1]}.${compactMatch[2]}`;
    }

    return normalized;
};
