import { Request, Response, NextFunction } from 'express';
import { getAuthToken } from '../helpers/getAuthToken';
import { verifyAuthToken } from '../helpers/verifyAuthToken';
import { UserService } from '../services/UserService';
import { UserRole } from '../interfaces/UserRole';
import { AppError } from '../errors/AppError';
import { ApiErrorCode } from '../errors/ApiErrorCode';

async function ensureAuthenticated(
    request: Request,
    _response: Response,
    next: NextFunction
) {
    const authToken = getAuthToken(request.headers.authorization);

    if (!authToken) {
        return next(AppError.fromCode(ApiErrorCode.AUTH_TOKEN_REQUIRED));
    }

    try {
        const authenticatedUser = verifyAuthToken(authToken);
        const authenticatedUserId = typeof authenticatedUser.id === 'string'
            ? authenticatedUser.id
            : undefined;

        if (!authenticatedUserId) {
            return next(AppError.fromCode(ApiErrorCode.AUTH_SESSION_EXPIRED));
        }

        const userService = new UserService();
        const user = await userService.getUserByID(authenticatedUserId);

        if (!user) {
            return next(AppError.fromCode(ApiErrorCode.AUTH_USER_UNAVAILABLE));
        }

        request.headers.authenticatedUserId = authenticatedUserId;

        return next();
    } catch (err) {
        return next(AppError.fromCode(ApiErrorCode.AUTH_SESSION_EXPIRED));
    }
}

async function ensureAdminAuthenticated(
    request: Request,
    _response: Response,
    next: NextFunction
) {
    try {
        const userId = request.headers.authenticatedUserId as string;

        if (!userId) {
            return next(AppError.fromCode(ApiErrorCode.AUTH_TOKEN_REQUIRED));
        }

        const userService = new UserService();
        const user = await userService.getUserByID(userId);

        if (!user) {
            return next(AppError.fromCode(ApiErrorCode.AUTH_USER_UNAVAILABLE));
        }

        if (!user.role || (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN)) {
            return next(AppError.fromCode(ApiErrorCode.AUTH_FORBIDDEN));
        }

        return next();
    } catch (err) {
        return next(err);
    }
}

async function ensureSuperAdminAuthenticated(
    request: Request,
    _response: Response,
    next: NextFunction
) {
    try {
        const userId = request.headers.authenticatedUserId as string;

        if (!userId) {
            return next(AppError.fromCode(ApiErrorCode.AUTH_TOKEN_REQUIRED));
        }

        const userService = new UserService();
        const user = await userService.getUserByID(userId);

        if (!user) {
            return next(AppError.fromCode(ApiErrorCode.AUTH_USER_UNAVAILABLE));
        }

        if (!user.role || user.role !== UserRole.SUPER_ADMIN) {
            return next(AppError.fromCode(ApiErrorCode.AUTH_FORBIDDEN));
        }

        return next();
    } catch (err) {
        return next(err);
    }
}

export { ensureAuthenticated, ensureAdminAuthenticated, ensureSuperAdminAuthenticated };
