import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { LoginRequestDto, RefreshTokenRequestDto, ResetPasswordRequestDto, ConfirmResetPasswordRequestDto } from '../dtos/auth';
import { ensureAuthenticated } from '../middlewares/EnsureAuthenticated';
import { makeValidateBody } from '../middlewares/Validator';

const authRouter = Router();
const authController = new AuthController();

/**
* @swagger
* tags:
*   name: Auth
*   description: The Auth managing API
*/

/**
* @swagger
* components:
*   schemas:
*     Auth:
*       type: object
*       required:
*         - email
*         - password
*       properties:
*         email:
*           type: string
*           description: The user email
*         password:
*           type: string
*           description: The user password
*       example:
*         token: emhlcnNvbkBn4ODIsImV4cCI6MTY0NzQ1ODQ4Mn0.Vhasas113131212asasasasaasafojkojosmR8-avh8VWN-ZSrjCytfw11GDGYySzYXCPuHw62c
 *     ErrorResponse:
 *       type: object
 *       required:
 *         - message
 *       properties:
 *         message:
 *           type: string
 *           description: Standardized error message returned by the API
 *       example:
 *         message: Only UFBA institutional email addresses are allowed.
*/

authRouter.get('/user', ensureAuthenticated, authController.getCurrentUser);
/**
* @swagger
* /api/auth/login:
*   post:
*     summary: Return an auth token after user has been logged
*     tags: [Auth]
*     parameters:
*       - in: body
*         name: email
*         schema:
*           type: string
*         required: true
*         description: The user email
*       - in: body
*         name: password
*         schema:
*           type: string
*         required: true
*         description: The user password
*     responses:
*       201:
*         description: Auth token was created and returned
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/Auth'
*       400:
*         description: Bad Request
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*       404:
*         description: Error during the authentication
*       500:
*         description: Internal Server Error
*/
authRouter.post('/login', makeValidateBody(LoginRequestDto), authController.login);
authRouter.post('/refresh', makeValidateBody(RefreshTokenRequestDto), authController.refresh);

/**
* @swagger
* /api/auth/reset-password:
*   post:
*     summary: Return an email with new password
*     tags: [Auth]
*     parameters:
*       - in: body
*         name: email
*         schema:
*           type: string
*         required: true
*         description: The user email
*     responses:
*       200:
*         description: Success
*       400:
*         description: Bad Request
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*       404:
*         description: User not found
*       500:
*         description: Internal Server Error
*/
authRouter.post('/reset-password', makeValidateBody(ResetPasswordRequestDto), authController.resetPassword);
authRouter.post('/reset-password/confirm', makeValidateBody(ConfirmResetPasswordRequestDto), authController.confirmResetPassword);

export { authRouter };
