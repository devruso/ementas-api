import { getCustomRepository } from 'typeorm';
import { sign, verify } from 'jsonwebtoken';

import { ApiErrorCode } from '../errors/ApiErrorCode';
import { AuthService } from '../services/AuthService';

jest.mock('typeorm', () => {
    const actualTypeorm = jest.requireActual('typeorm');

    return {
        ...actualTypeorm,
        getCustomRepository: jest.fn(),
    };
});

jest.mock('jsonwebtoken', () => ({
    sign: jest.fn(),
    verify: jest.fn(),
}));

describe('AuthService refresh token flow', () => {
    const repositoryMock = {
        findOne: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (getCustomRepository as jest.Mock).mockReturnValue(repositoryMock);

        process.env.JWT_SECRET = 'secret';
        process.env.JWT_DEADLINE = '3600';
        process.env.JWT_REFRESH_SECRET = 'refresh-secret';
        process.env.JWT_REFRESH_DEADLINE = '86400';
    });

    it('should return access and refresh tokens on login', async () => {
        repositoryMock.findOne.mockResolvedValueOnce({
            id: 'user-1',
            name: 'Professor',
            email: 'professor@ufba.br',
        });

        (sign as jest.Mock)
            .mockReturnValueOnce('access-token')
            .mockReturnValueOnce('refresh-token');

        const service = new AuthService();
        const session = await service.login('professor@ufba.br', 'senha123');

        expect(session).toEqual({
            token: 'access-token',
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            expiresIn: 3600,
            refreshExpiresIn: 86400,
        });

        expect(sign).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ tokenType: 'access', id: 'user-1' }),
            'secret',
            { expiresIn: 3600 }
        );
        expect(sign).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ tokenType: 'refresh', id: 'user-1' }),
            'refresh-secret',
            { expiresIn: 86400 }
        );
    });

    it('should refresh session when refresh token is valid', async () => {
        (verify as jest.Mock).mockReturnValueOnce({ id: 'user-1', tokenType: 'refresh' });
        repositoryMock.findOne.mockResolvedValueOnce({
            id: 'user-1',
            name: 'Professor',
            email: 'professor@ufba.br',
        });
        (sign as jest.Mock)
            .mockReturnValueOnce('new-access-token')
            .mockReturnValueOnce('new-refresh-token');

        const service = new AuthService();
        const session = await service.refreshSession('valid-refresh-token');

        expect(verify).toHaveBeenCalledWith('valid-refresh-token', 'refresh-secret');
        expect(session.accessToken).toBe('new-access-token');
        expect(session.refreshToken).toBe('new-refresh-token');
    });

    it('should refresh session using legacy access token as migration path', async () => {
        (verify as jest.Mock)
            .mockImplementationOnce(() => {
                throw new Error('invalid refresh token signature');
            })
            .mockReturnValueOnce({ id: 'user-1', tokenType: 'access' });
        repositoryMock.findOne.mockResolvedValueOnce({
            id: 'user-1',
            name: 'Professor',
            email: 'professor@ufba.br',
        });
        (sign as jest.Mock)
            .mockReturnValueOnce('migrated-access-token')
            .mockReturnValueOnce('migrated-refresh-token');

        const service = new AuthService();
        const session = await service.refreshSession('legacy-access-token');

        expect(verify).toHaveBeenNthCalledWith(1, 'legacy-access-token', 'refresh-secret');
        expect(verify).toHaveBeenNthCalledWith(2, 'legacy-access-token', 'secret');
        expect(session.accessToken).toBe('migrated-access-token');
        expect(session.refreshToken).toBe('migrated-refresh-token');
    });

    it('should reject refresh when token type is invalid', async () => {
        (verify as jest.Mock).mockReturnValueOnce({ id: 'user-1', tokenType: 'unsupported' });

        const service = new AuthService();

        await expect(service.refreshSession('invalid-type')).rejects.toMatchObject({
            statusCode: 401,
            code: ApiErrorCode.AUTH_SESSION_EXPIRED,
        });
    });

    it('should reject refresh when verify throws', async () => {
        (verify as jest.Mock).mockImplementationOnce(() => {
            throw new Error('jwt expired');
        });

        const service = new AuthService();

        await expect(service.refreshSession('expired-refresh')).rejects.toMatchObject({
            statusCode: 401,
            code: ApiErrorCode.AUTH_SESSION_EXPIRED,
        });
    });
});
