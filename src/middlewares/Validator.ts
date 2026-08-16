import { transformAndValidate } from 'class-transformer-validator';
import { ValidationError } from 'class-validator';
import { Request, Response, NextFunction } from 'express';
import { API_ERROR_CATALOG, ApiErrorCode } from '../errors/ApiErrorCode';

export const makeValidateBody = <T>(
    c: T,
    whitelist = true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    errorHandler?: (err: any, req: Request, res: Response, next: NextFunction) => void
) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        const toValidate = req.body ?? {};
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const transformed = await transformAndValidate(c as any, toValidate, { validator: { whitelist } });
            
            req.body = transformed;
            next();
        } catch (err) {
            if (errorHandler) {
                errorHandler(err, req, res, next);
            } else {
                const error = !Array.isArray(err) || !(err[0] instanceof ValidationError)
                    ? err
                    : err.map( e => ({
                        property: e.property,
                        reasons: Object.values(e.constraints ?? {}),
                    }));

                const definition = API_ERROR_CATALOG[ApiErrorCode.VALIDATION_FAILED];
                res.status(definition.statusCode).json({
                    code: ApiErrorCode.VALIDATION_FAILED,
                    message: definition.message,
                    reason: definition.reason,
                    recovery: definition.recovery,
                    error,
                });
            }
        }
    };
};
