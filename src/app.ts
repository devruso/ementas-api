import 'reflect-metadata';
import 'express-async-errors';
import cors from 'cors';
import multer from 'multer';
import express, { Request, Response, NextFunction }  from 'express';
import swaggerUi from 'swagger-ui-express';
import swaggerJsDoc from 'swagger-jsdoc';

import { router } from './routes';
import { AppError } from './errors/AppError';
import { API_ERROR_CATALOG, ApiErrorCode } from './errors/ApiErrorCode';
import { SwaggerOptions } from './configs/swagger.config';
import { logHandler } from './middlewares/logHandler';

const errorPayload = (code: ApiErrorCode) => {
    const definition = API_ERROR_CATALOG[code];
    return {
        code,
        message: definition.message,
        reason: definition.reason,
        recovery: definition.recovery,
    };
};

export const app = express();

app.use(cors());
app.use(express.json());
app.use(logHandler);
app.use(router);
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerJsDoc(SwaggerOptions)));
app.use((err: Error, request: Request, response: Response, _next: NextFunction) => {
    if(err instanceof AppError){
        return response.status(err.statusCode).json({
            code: err.code,
            message: err.message,
            reason: err.reason,
            recovery: err.recovery,
            details: err.details,
        });
    }

    if (err instanceof multer.MulterError) {
        const message = err.code === 'LIMIT_FILE_SIZE'
            ? (err.field === 'signatureFile'
                ? 'O arquivo de assinatura excede o limite de 2MB.'
                : 'O arquivo excede o limite de 10MB para importacao.')
            : err.message;

        return response.status(400).json({ message });
    }

    console.log(err);
    return response.status(500).json({
        ...errorPayload(ApiErrorCode.INTERNAL_ERROR),
    });
});
app.get('*', (req, res) => {
    res.status(404).send({
        ...errorPayload(ApiErrorCode.ROUTE_NOT_FOUND),
    });
});
