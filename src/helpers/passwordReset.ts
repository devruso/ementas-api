import { sign, verify } from 'jsonwebtoken';

import { AppError } from '../errors/AppError';
import { ApiErrorCode } from '../errors/ApiErrorCode';

const DEFAULT_PASSWORD_RESET_TTL_SECONDS = 24 * 60 * 60;

const normalizeBaseUrl = (value: string) => String(value || '').trim().replace(/\/+$/, '');

export const resolveFrontendBaseUrl = () => {
    return normalizeBaseUrl(
        process.env.APP_PUBLIC_URL
        || process.env.FRONTEND_BASE_URL
        || process.env.FRONTEND_URL
        || 'https://ementas.app.ic.ufba.br'
    );
};

export const buildPasswordResetLink = (token: string) => {
    return `${resolveFrontendBaseUrl()}/novasenha/${encodeURIComponent(token)}`;
};

export const generatePasswordResetToken = (email: string) => {
    return sign(
        { email: String(email || '').trim().toLowerCase() },
        String(process.env.JWT_SECRET),
        { expiresIn: DEFAULT_PASSWORD_RESET_TTL_SECONDS }
    );
};

export const resolvePasswordResetEmailFromToken = (token: string) => {
    try {
        const payload = verify(token, String(process.env.JWT_SECRET)) as { email?: string };
        const email = String(payload?.email || '').trim().toLowerCase();

        if (!email) {
            throw new Error('Missing email');
        }

        return email;
    } catch {
        throw AppError.fromCode(ApiErrorCode.AUTH_PASSWORD_RESET_LINK_INVALID);
    }
};
