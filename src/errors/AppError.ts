import { API_ERROR_CATALOG, ApiErrorCode } from './ApiErrorCode';

export class AppError extends Error {
    public readonly statusCode: number;
    public readonly code?: ApiErrorCode;
    public readonly reason?: string;
    public readonly recovery?: string;
    public readonly details?: Record<string, unknown>;

    constructor(
        message: string,
        statusCode = 400,
        options?: {
            code?: ApiErrorCode;
            reason?: string;
            recovery?: string;
            details?: Record<string, unknown>;
        }
    ){
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.code = options?.code;
        this.reason = options?.reason;
        this.recovery = options?.recovery;
        this.details = options?.details;
        Object.setPrototypeOf(this, AppError.prototype);
    }

    static fromCode(
        code: ApiErrorCode,
        options?: { message?: string; details?: Record<string, unknown> }
    ) {
        const definition = API_ERROR_CATALOG[code];

        return new AppError(options?.message || definition.message, definition.statusCode, {
            code,
            reason: definition.reason,
            recovery: definition.recovery,
            details: options?.details,
        });
    }
}
