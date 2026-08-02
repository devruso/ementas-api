import { COURSE_CATALOG, getCourseFilterAliases, normalizeCourseNameFromSource } from '../helpers/courseCatalog';

describe('courseCatalog', () => {
    it('should expose PMCC as the mechatronics graduate program', () => {
        expect(COURSE_CATALOG.PMCC).toBe('Programa de P\u00f3s-Gradua\u00e7\u00e3o em Mecatr\u00f4nica');
    });

    it('should normalize legacy PMCC labels to the mechatronics graduate program', () => {
        expect(normalizeCourseNameFromSource('Programa Multidisciplinar em Ci\u00eancia da Computa\u00e7\u00e3o'))
            .toBe(COURSE_CATALOG.PMCC);
        expect(normalizeCourseNameFromSource('PROGRAMA DE P\u00d3S-GRADUA\u00c7\u00c3O EM CI\u00caNCIA DA COMPUTA\u00c7\u00c3O (PMCC)'))
            .toBe(COURSE_CATALOG.PMCC);
        expect(normalizeCourseNameFromSource('PMCC'))
            .toBe(COURSE_CATALOG.PMCC);
    });

    it('should keep legacy PMCC labels searchable when filtering by the new name', () => {
        const aliases = getCourseFilterAliases(COURSE_CATALOG.PMCC);

        expect(aliases).toEqual(expect.arrayContaining([
            'programa de pos-graduacao em mecatronica',
            'programa multidisciplinar em ciencia da computacao',
            'programa de pos-graduacao em ciencia da computacao (pmcc)',
            'pmcc',
        ]));
    });
});
