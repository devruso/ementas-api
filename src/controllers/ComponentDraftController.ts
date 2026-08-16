import { Request, Response } from 'express';
import { paginate } from '../helpers/paginate';
import { ComponentDraftService } from '../services/ComponentDraftService';
import { DocumentImportService } from '../services/DocumentImportService';

class ComponentDraftController {
    async getDrafts(request: Request, response: Response) {
        const draftService = new ComponentDraftService();

        const search = String(request.query.search ?? request.query.filter ?? '').trim() || undefined;
        const sortBy = String(request.query.sortBy ?? '').trim() || undefined;
        const sortOrder = String(request.query.sortOrder ?? 'DESC').toUpperCase() === 'ASC'
            ? 'ASC'
            : 'DESC';
        const page = parseInt(String(request.query.page)) || 0;
        const limit = parseInt(String(request.query.limit)) || 10;

        const components = await draftService.getDrafts({ search, sortBy, sortOrder });

        return response.status(200).json(paginate(components, { page, limit, search, sortBy, sortOrder }));
    }

    async getDraftByCode(request: Request, response: Response) {
        const draftService = new ComponentDraftService();
        const component = await draftService.getDraftByCode(request.params.code);

        return response.status(200).json(component);
    }

    async create(request: Request, response: Response) {
        const authenticatedUserId = request.headers.authenticatedUserId as string;
        const draftService = new ComponentDraftService();

        const content = await draftService.create(authenticatedUserId, request.body);

        return response.status(201).json(content);
    }

    async update(request: Request, response: Response) {
        const { id } = request.params;
        const authenticatedUserId = request.headers.authenticatedUserId as string;

        const draftService = new ComponentDraftService();
        const content = await draftService.update(
            id,
            authenticatedUserId,
            request.body
        );

        return response.status(200).json(content);
    }

    async delete(request: Request, response: Response) {
        const { id } = request.params;

        const draftService = new ComponentDraftService();
        await draftService.delete(id);

        return response.status(200).json({ message: 'Draft has been deleted!' });
    }

    async approve(request: Request, response: Response) {
        const { id } = request.params;
        const authenticatedUserId = request.headers.authenticatedUserId as string;

        const draftService = new ComponentDraftService();
        const component = await draftService.approve(id, request.body, authenticatedUserId);

        return response.status(200).json(component);
    }

    async getPublicationContext(request: Request, response: Response) {
        const authenticatedUserId = request.headers.authenticatedUserId as string;
        const draftService = new ComponentDraftService();
        const context = await draftService.getPublicationContext(
            request.params.id,
            authenticatedUserId
        );

        return response.status(200).json(context);
    }

    async importPreview(request: Request, response: Response) {
        const documentImportService = new DocumentImportService();
        const preview = await documentImportService.generatePreview(
            request.file as Express.Multer.File
        );

        return response.status(200).json(preview);
    }

}

export { ComponentDraftController };
