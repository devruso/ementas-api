import { Router } from 'express';
import { UserController } from '../controllers/UserController';
import {
	CreateTeacherByAdminRequestDto,
	CreateUserRequestDto,
	SendInviteByEmailRequestDto,
	UpdateUserRequestDto,
	UpdateUserRoleRequestDto,
	UpdateUserSignatureRequestDto,
} from '../dtos/user';
import {
	ensureAdminAuthenticated,
	ensureAuthenticated,
	ensureSuperAdminAuthenticated,
} from '../middlewares/EnsureAuthenticated';
import { uploadUserSignatureFile } from '../middlewares/Upload';
import { makeValidateBody } from '../middlewares/Validator';

const userRouter = Router();
const userController = new UserController();

/**
* @swagger
* tags:
*   name: User
*   description: The User managing API
*/

/**
* @swagger
* components:
*   schemas:
*     User:
*       type: object
*       required:
*         - name
*         - email
*         - password
*       properties:
*         id:
*           type: string
*           description: The uuid of the user
*         name:
*           type: string
*           description: The user name
*         email:
*           type: string
*           description: The user email
*         password:
*           type: string
*           description: The user password
*         role:
*           type: string
*           description: teacher by default
*         isUserActive:
*           type: boolean
*           description: true by default
*         createdAt:
*           type: date
*           description: The date that user has been created
*         updatedAt:
*           type: date
*           description: The date that user has been updated
*       example:
*         id: 50496915-d356-43a0-84a4-43f83bad2225
*         name: Javus da Silva Pythonlino
*         email: user@email.com
*         isUserActive: true
*         role: teacher
*         password: user010203!!!
*         createdAt: 2022-03-18 17:12:52
*         updatedAt: 2022-03-18 17:12:52
*/

/**
* @swagger
* /api/users:
*   get:
*     summary: Returns the list of all the users
*     tags: [User]
*     responses:
*       200:
*         description: The list of all the users
*         content:
*           application/json:
*             schema:
*               type: array
*               items:
*                 $ref: '#/components/schemas/User'
*       400:
*         description: Bad Request
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*       500:
*         description: Internal Server Error
*/
userRouter.get('/', ensureAuthenticated, ensureAdminAuthenticated, userController.getUsers);

userRouter.post(
	'/create-teacher',
	ensureAuthenticated,
	ensureAdminAuthenticated,
	makeValidateBody(CreateTeacherByAdminRequestDto),
	userController.createTeacherByAdmin
);

userRouter.post(
	'/invite-email',
	ensureAuthenticated,
	ensureAdminAuthenticated,
	makeValidateBody(SendInviteByEmailRequestDto),
	userController.sendInviteByEmail
);

/**
* @swagger
* /api/users/{inviteToken}:
*   post:
*     summary: Create a user
*     tags: [User]
*     parameters:
*       - in: params
*         name: inviteToken
*         schema:
*           type: string
*         required: true
*         description: The generated token invitation
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
*       - in: body
*         name: name
*         schema:
*           type: string
*         required: true
*         description: The user name
*     responses:
*       201:
*         description: The user has been created.
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/User'
*       400:
*         description: Bad Request
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*       500:
*         description: Internal Server Error
*/
userRouter.post('/:inviteToken', makeValidateBody(CreateUserRequestDto), userController.create);

/**
* @swagger
* /api/users/update/email:
*   put:
*     summary: Update user email
*     tags: [User]
*     parameters:
*       - in: header
*         name: authenticatedUserId
*         schema:
*           type: string
*         required: true
*         description: The authenticated user id
*       - in: body
*         name: email
*         schema:
*           type: string
*         required: true
*         description: The user email
*     responses:
*       200:
*         description: The user has been updated.
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/User'
*       400:
*         description: Bad Request
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ErrorResponse'
*       404:
*         description: The user was not found
*       500:
*         description: Internal Server Error
*/
userRouter.put('/update/email', ensureAuthenticated, makeValidateBody(UpdateUserRequestDto), userController.updateEmail);

/**
* @swagger
* /api/users/update/password:
*   put:
*     summary: Update user password
*     tags: [User]
*     parameters:
*       - in: header
*         name: authenticatedUserId
*         schema:
*           type: string
*         required: true
*         description: The authenticated user id
*       - in: body
*         name: password
*         schema:
*           type: string
*         required: true
*         description: The user password
*     responses:
*       200:
*         description: The user has been updated.
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/User'
*       400:
*         description: Bad Request
*       404:
*         description: The user was not found
*       500:
*         description: Internal Server Error
*/
userRouter.put('/update/password', ensureAuthenticated, makeValidateBody(UpdateUserRequestDto), userController.updatePassword);

userRouter.put('/update/signature', ensureAuthenticated, makeValidateBody(UpdateUserSignatureRequestDto), userController.updateSignature);
userRouter.put('/update/signature/file', ensureAuthenticated, uploadUserSignatureFile.single('signatureFile'), userController.updateSignatureFile);
userRouter.get('/signature/file', ensureAuthenticated, userController.getSignatureFilePreview);

userRouter.put('/:id/role', ensureAuthenticated, ensureSuperAdminAuthenticated, makeValidateBody(UpdateUserRoleRequestDto), userController.updateRole);

/**
* @swagger
* /api/users/{id}:
*   delete:
*     summary: Delete an user by ID
*     tags: [User]
*     parameters:
*       - in: params
*         name: id
*         schema:
*           type: string
*         required: true
*         description: The user id
*     responses:
*       200:
*         description: User has been deleted!
*       400:
*         description: Bad Request
*       500:
*         description: Internal Server Error
*/
userRouter.delete('/:id', ensureAuthenticated, ensureAdminAuthenticated, userController.delete);

export { userRouter };
