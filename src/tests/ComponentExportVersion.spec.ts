import 'reflect-metadata';
import { getCustomRepository } from 'typeorm';
import { ComponentService } from '../services/ComponentService';
import { ComponentStatus } from '../interfaces/ComponentStatus';
import { ComponentLogType } from '../interfaces/ComponentLogType';
import { UserSignatureAssetService } from '../services/export/UserSignatureAssetService';

jest.mock('typeorm', () => ({ ...jest.requireActual('typeorm'), getCustomRepository: jest.fn() }));

describe('Export version selection', () => {
    const component = {
        id: 'component', code: 'IC045', name: 'Published', status: ComponentStatus.PUBLISHED,
        syllabus: 'Old syllabus', workload: { studentTheory: 30 },
        logs: [ { type: ComponentLogType.APPROVAL, createdAt: new Date(), agreementNumber: 'ATA-1', user: { name: 'Teacher' } } ],
        draft: { id: 'draft', code: 'IC045', name: 'Saved draft', syllabus: 'Latest saved syllabus', workload: { studentTheory: 60 } },
    };

    const setup = () => {
        const query = {
            leftJoinAndSelect: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            getOne: jest.fn().mockResolvedValue(component),
        };
        (getCustomRepository as jest.Mock).mockReturnValue({ createQueryBuilder: () => query });
        const signature = jest.spyOn(UserSignatureAssetService.prototype, 'loadForDocument').mockResolvedValue(null);
        const converter = { convert: jest.fn().mockReturnValue(Buffer.from('%PDF-test')) };
        const service = new ComponentService(converter);
        // Inspect the same document data used by both PDF conversion and DOCX output.
        const template = jest.fn().mockReturnValue(Buffer.from('docx'));
        Object.assign(service, { fillDocxTemplateFromBase: template });
        return { service, template, signature, converter, query };
    };

    afterEach(() => jest.restoreAllMocks());

    it.each([ 'pdf', 'docx' ] as const)('exports latest saved draft to %s without published approval', async (format) => {
        const { service, template, signature } = setup();
        await service.export('component', format, 'draft');
        expect(template.mock.calls[0][0]).toMatchObject({ syllabus: 'Latest saved syllabus', status: ComponentStatus.DRAFT, workload: { student: { theory: 60 } } });
        expect(template.mock.calls[0][0].approval).toBeUndefined();
        expect(signature).toHaveBeenCalledWith(undefined);
    });

    it('preserves official export as the default', async () => {
        const { service, template } = setup();
        await service.export('component', 'docx');
        expect(template.mock.calls[0][0]).toMatchObject({ syllabus: 'Old syllabus', approval: { agreementNumber: 'ATA-1' }, workload: { student: { theory: 30 } } });
    });

    it('does not silently export official content when a draft is missing', async () => {
        const { service, query } = setup();
        query.getOne.mockResolvedValue({ ...component, draft: undefined });
        await expect(service.export('component', 'pdf', 'draft')).rejects.toMatchObject({ statusCode: 404 });
    });
});
