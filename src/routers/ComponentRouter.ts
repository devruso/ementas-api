import { Router } from 'express';
import { ComponentController } from '../controllers/ComponentController';
import { CreateComponentRequestDto, UpdateComponentRequestDto } from '../dtos/component';
import { ensureAdminAuthenticated, ensureAuthenticated } from '../middlewares/EnsureAuthenticated';
import { makeValidateBody } from '../middlewares/Validator';

const componentRouter = Router();
const componentController = new ComponentController();

/**
* @swagger
* tags:
*   name: Component
*   description: The Component managing API
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
*           description: The auto-generated id of the user
*         name:
*           type: string
*           description: The user name
*         email:
*           type: string
*           description: The user email
*         password:
*           type: string
*           description: The user password
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
*         password: user010203!!!
*         createdAt: 2022-03-18 17:12:52
*         updatedAt: 2022-03-18 17:12:52
*
*     Workload:
*       type: object
*       required:
*         - id
*         - studentTheory
*         - studentPractice
*         - studentInternship
*         - studentTheoryPractice
*         - studentPracticeInternship
*         - teacherTheory
*         - teacherPractice
*         - teacherInternship
*         - teacherTheoryPractice
*         - teacherPracticeInternship
*         - moduleTheory
*         - modulePractice
*         - moduleInternship
*         - moduleTheoryPractice
*         - modulePracticeInternship
*       properties:
*         id:
*           type: number
*           description: The auto-generated id of the workload
*         studentTheory:
*           type: number
*           description: The student's theory workload
*         studentPractice:
*           type: number
*           description: The student's practice workload
*         studentInternship:
*           type: number
*           description: The student's internship workload
*         studentTheoryPractice:
*           type: number
*           description: The student's theoryPractice workload
*         studentPracticeInternship:
*           type: number
*           description: The student's practiceInternship workload
*         teacherTheory:
*           type: number
*           description: The teacher's theory workload
*         teacherPractice:
*           type: number
*           description: The teacher's practice workload
*         teacherInternship:
*           type: number
*           description: The teacher's internship workload
*         teacherTheoryPractice:
*           type: number
*           description: The teacher's theoryPractice workload
*         teacherPracticeInternship:
*           type: number
*           description: The teacher's practiceInternship workload
*         moduleTheory:
*           type: number
*           description: The module's theory workload
*         modulePractice:
*           type: number
*           description: The module's practice workload
*         moduleInternship:
*           type: number
*           description: The module's internship workload
*         moduleTheoryPractice:
*           type: number
*           description: The module's theoryPractice workload
*         modulePracticeInternship:
*           type: number
*           description: The module's practiceInternship workload
*       example:
*         id: 3
*         studentTheory: 68
*         studentPractice: 34
*         studentInternship: 0
*         studentTheoryPractice: 0
*         studentPracticeInternship: 0
*         teacherTheory: 68
*         teacherPractice: 34
*         teacherInternship: 0
*         teacherTheoryPractice: 0
*         teacherPracticeInternship: 0
*         moduleTheory: 68
*         modulePractice: 34
*         moduleInternship: 0
*         moduleTheoryPractice: 0
*         modulePracticeInternship: 0
*
*     Component:
*       type: object
*       required:
*         - id
*         - userId
*         - createdAt
*         - updatedAt
*       properties:
*         id:
*           type: string
*           description: The uuid id of the component
*         code:
*           type: string
*           description: Component's code
*         name:
*           type: string
*           description: Component's name
*         department:
*           type: string
*           description: Component's department
*         type:
*           type: string
*           description: Type of component (optional or required)
*         prerequeriments:
*           type: string
*           description: The component that are prerequeriments
*         semester:
*           type: string
*           description: First acting semester of component
*         syllabus:
*           type: string
*           description: Component's syllabus
*         program:
*           type: string
*           description: Component's program
*         objective:
*           type: string
*           description: Component's objective
*         metolodogy:
*           type: string
*           description: Metodology applied by the professor
*         bibliography:
*           type: string
*           description: Book references
*         createdAt:
*           type: date
*           description: Date of component's creation
*         updatedAt:
*           type: date
*           description: Date of component's last update
*         userId:
*           type: string
*           description: Componen's creator's uid
*         user:
*           $ref: '#/components/schemas/User'
*         workloadId:
*           type: string
*           description: Content's workload
*         workload:
*           $ref: '#/components/schemas/Workload'
*       example:
*         id: 27
*         name: Geometria Analítica
*         userId: 50496915-d356-43a0-84a4-43f83bad2225
*         createdAt: 2022-03-18 17:12:52
*         updatedAt: 2022-03-18 17:12:52
*         workloadId: abcdef6
*/

/**
 *    ContentUpsert:
 *       type: object
 *       required:
 *         - id
 *         - userId
 *         - createdAt
 *         - updatedAt
 *       properties:
 *         code:
 *           type: string
 *           description: Component's code
 *         name:
 *           type: string
 *           description: Component's name
 *         department:
 *           type: string
 *           description: Component's department
 *          teachingWorkload:
 *           type: number
 *           description: Amount of hours invented in the component
 *         studentWorkload:
 *           type: number
 *           description: Amount of in-class hours invested in the component
 *         kind:
 *           type: string
 *           description: Kind of component (optional or required)
 *          module:
 *           type: string
 *           description: Type of module
 *         semester:
 *           type: string
 *           description: First acting semester of component
 *         syllabus:
 *           type: string
 *           description: Component's syllabus
 *         program:
 *           type: string
 *           description: Component's program
 *         objective:
 *           type: string
 *           description: Component's objective
 *         metolodogy:
 *           type: string
 *           description: Metodology applied by the professor
 *         bibliography:
 *           type: string
 *           description: Book references
 *         createdAt:
 *           type: date
 *           description: Date of content's creation
 *         updatedAt:
 *           type: date
 *           description: Date of content's last update
 *         workloadId:
 *           type: number
 *           description: Id of component's workload
 *         workload:
 *           type: object
 *       example:
 *         name: Geometria Analitica
 *         code: MATA01
*/

/**
* @swagger
* /api/components:
*   get:
*     summary: Returns the list of all the component
*     tags: [Component]
*     responses:
*       200:
*         description: The list of all the component
*         content:
*           application/json:
*             schema:
*               type: array
*               items:
*                 $ref: '#/components/schemas/Component'
*       400:
*         description: Bad Request
*       500:
*         description: Internal Server Error
*/
componentRouter.get('/', ensureAuthenticated, componentController.getComponents);

componentRouter.get('/shared/:token', componentController.getSharedPublicComponent);

/**
* @swagger
* /api/components/metadata:
*   get:
*     summary: Get canonical options used by component forms and filters
*     tags: [Component]
*     responses:
*       200:
*         description: Component domain metadata
*/
componentRouter.get('/metadata', componentController.getMetadata);

/**
 * @swagger
 * /api/components/{code}:
 *   get:
 *     summary: Get a component by code
 *     tags: [Component]
 *     parameters:
 *       - in: header
 *         name: authenticatedUserId
 *         schema:
 *           type: string
 *         required: true
 *         description: The authenticated user id
 *       - in: params
 *         name: code
 *         schema:
 *           type: string
 *         required: true
 *         description: The component code
 *
 *     responses:
 *       200:
 *         description: The component was found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               items:
 *                 $ref: '#/components/schemas/Component'
 *       400:
 *         description: Bad Request
 *       404:
 *         description: The component was not found
 *       500:
 *         description: Internal Server Error
 */
componentRouter.get('/:code', ensureAuthenticated, componentController.getComponentByCode);

componentRouter.get('/:id/logs', ensureAuthenticated, componentController.getComponentLogs);

/**
* @swagger
* /api/components:
*   post:
*     summary: Create a component
*     tags: [Component]
*     parameters:
*       - in: header
*         name: authenticatedUserId
*         schema:
*           type: string
*         required: true
*         description: The authenticated user id
*       - in: body
*         name: code
*         schema:
*           type: string
*         required: false
*         description: Component's code
*       - in: body
*         name: name
*         schema:
*           type: string
*         required: false
*         description: Component's name
*       - in: body
*         name: department
*         schema:
*           type: string
*         required: false
*         description: Component's department
*       - in: body
*         name: prerequeriments
*         schema:
*           type: string
*         required: false
*         description: Component's prerequeriments
*       - in: body
*         name: semester
*         schema:
*           type: string
*         required: false
*         description: First acting semester of component
*       - in: body
*         name: syllabus
*         schema:
*           type: string
*         required: false
*         description: Component's syllabus
*       - in: body
*         name: program
*         schema:
*           type: string
*         required: false
*         description: Component's program
*       - in: body
*         name: objective
*         schema:
*           type: string
*         required: false
*         description: Component's objective
*       - in: body
*         name: metolodogy
*         schema:
*           type: string
*         required: false
*         description: Metodology applied by the professor
*       - in: body
*         name: bibliography
*         schema:
*           type: string
*         required: false
*         description: Book references
*       - in: body
*         name: workload
*         schema:
*           type: object
*           properties:
*             studentTheory:
*               type: number
*               required: false
*               description: The student's theory workload
*             studentPractice:
*               type: number
*               required: false
*               description: The student's practice workload
*             studentInternship:
*               type: number
*               required: false
*               description: The student's internship workload
*             studentTheoryPractice:
*               type: number
*               required: false
*               description: The student's theory-practice workload
*             studentPracticeInternship:
*               type: number
*               required: false
*               description: The student's practice-internship workload
*             teacherTheory:
*               type: number
*               required: false
*               description: The teacher's Theory workload
*             teacherPractice:
*               type: number
*               required: false
*               description: The teacher's Practice workload
*             teacherInternship:
*               type: number
*               required: false
*               description: The teacher's Internship workload
*             teacherTheoryPractice:
*               type: number
*               required: false
*               description: The teacher's Theory Practice workload
*             teacherPracticeInternship:
*               type: number
*               required: false
*               description: The teacher's Practice Internship workload
*             moduleTheory:
*               type: number
*               required: false
*               description: The module's Theory workload
*             modulePractice:
*               type: number
*               required: false
*               description: The module's Practice workload
*             moduleInternship:
*               type: number
*               required: false
*               description: The module's Internship workload
*             moduleTheoryPractice:
*               type: number
*               required: false
*               description: The module's Theory Practice workload
*             modulePracticeInternship:
*               type: number
*               required: false
*               description: The module's Practice Internship workload
*       - in: body
*         name: createdAt
*         schema:
*           type: date
*         required: false
*         description: Date of content's creation
*       - in: body
*         name: updatedAt
*         schema:
*           type: date
*         required: false
*         description: Date of content's last update
*     responses:
*       201:
*         description: The content has been created
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/Content'
*       400:
*         description: An error has been ocurred.
*/
componentRouter.post('/', ensureAuthenticated, makeValidateBody(CreateComponentRequestDto), componentController.create);

/**
* @swagger
* /api/components/{id}:
*   put:
*     summary: Update a component
*     tags: [Component]
*     parameters:
*       - in: header
*         name: authenticatedUserId
*         schema:
*           type: string
*         required: true
*         description: The authenticated user id
*       - in: params
*         name: id
*         schema:
*           type: string
*         required: true
*         description: The component id
*       - in: body
*         name: code
*         schema:
*           type: string
*         required: false
*         description: Component's code
*       - in: body
*         name: name
*         schema:
*           type: string
*         required: false
*         description: Component's name
*       - in: body
*         name: department
*         schema:
*           type: string
*         required: false
*         description: Component's department
*       - in: body
*         name: prerequeriments
*         schema:
*           type: string
*         required: false
*         description: Component's prerequeriments
*       - in: body
*         name: semester
*         schema:
*           type: string
*         required: false
*         description: First acting semester of component
*       - in: body
*         name: syllabus
*         schema:
*           type: string
*         required: false
*         description: Component's syllabus
*       - in: body
*         name: program
*         schema:
*           type: string
*         required: false
*         description: Component's program
*       - in: body
*         name: objective
*         schema:
*           type: string
*         required: false
*         description: Component's objective
*       - in: body
*         name: metolodogy
*         schema:
*           type: string
*         required: false
*         description: Metodology applied by the professor
*       - in: body
*         name: bibliography
*         schema:
*           type: string
*         required: false
*         description: Book references
*       - in: body
*         name: workloadId
*         schema:
*           type: number
*         required: false
*         description: the component's workload id
*       - in: body
*         name: workload
*         schema:
*           type: object
*           properties:
*             studentTheory:
*               type: number
*               required: false
*               description: The student's theory workload
*             studentPractice:
*               type: number
*               required: false
*               description: The student's practice workload
*             studentInternship:
*               type: number
*               required: false
*               description: The student's internship workload
*             studentTheoryPractice:
*               type: number
*               required: false
*               description: The student's theory-practice workload
*             studentPracticeInternship:
*               type: number
*               required: false
*               description: The student's practice-internship workload
*             teacherTheory:
*               type: number
*               required: false
*               description: The teacher's Theory workload
*             teacherPractice:
*               type: number
*               required: false
*               description: The teacher's Practice workload
*             teacherInternship:
*               type: number
*               required: false
*               description: The teacher's Internship workload
*             teacherTheoryPractice:
*               type: number
*               required: false
*               description: The teacher's Theory Practice workload
*             teacherPracticeInternship:
*               type: number
*               required: false
*               description: The teacher's Practice Internship workload
*             moduleTheory:
*               type: number
*               required: false
*               description: The module's Theory workload
*             modulePractice:
*               type: number
*               required: false
*               description: The module's Practice workload
*             moduleInternship:
*               type: number
*               required: false
*               description: The module's Internship workload
*             moduleTheoryPractice:
*               type: number
*               required: false
*               description: The module's Theory Practice workload
*             modulePracticeInternship:
*               type: number
*               required: false
*               description: The module's Practice Internship workload
*         required: false
*         description: Compoenent's workload data
*       - in: body
*         name: createdAt
*         schema:
*           type: date
*         required: false
*         description: Date of component's creation
*       - in: body
*         name: updatedAt
*         schema:
*           type: date
*         required: false
*         description: Date of component's last update
*       - in: body
*         name: approval
*         schema:
*           type: object
*           properties:
*             agreementNumber:
*               type: string
*               required: false
*               description: The number of the minute in which the component syllabus was approved
*             agreementDate:
*               type: date
*               required: false
*               description: The date in which the component syllabus was approved
*
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             $ref: '#/components/schemas/ComponentUpsert'
*     responses:
*       200:
*         description: The component component has been updated
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/Component'
*       400:
*         description: Bad Request
*       404:
*         description: The component was not found
*       500:
*         description: Internal Server Error
*/
componentRouter.put('/:id', ensureAuthenticated, makeValidateBody(UpdateComponentRequestDto), componentController.update);

/**
 * @swagger
 * /api/components/{id}:
 *   delete:
 *     summary: Delete a component by id
 *     tags: [Component]
 *     parameters:
 *       - in: header
 *         name: authenticatedUserId
 *         schema:
 *           type: string
 *         required: true
 *         description: The authenticated user id
 *       - in: params
 *         name: id
 *         schema:
 *           type: number
 *         required: true
 *         description: The component id
 *
 *     responses:
 *       200:
 *         description: The component was deleted
 *       400:
 *         description: Bad Request
 *       404:
 *         description: The component was not found
 *       500:
 *         description: Internal Server Error
 */
componentRouter.delete('/:id', ensureAuthenticated, componentController.delete);

/**
* @swagger
* /api/components/import:
*   post:
*     summary: Import and insert components from UFBA website in the database
*     tags: [Component]
*     security:
*       - bearerAuth: []
*     parameters:
*       - in: header
*         name: authenticatedUserId
*         schema:
*           type: string
*         required: true
*         description: The authenticated user id
*       - in: body
*         name: cdCurso
*         schema:
*           type: string
*         required: true
*         description: The course code
*       - in: body
*         name: nuPerCursoInicial
*         schema:
*           type: string
*         required: true
*         description: The course current semester
*     responses:
*       201:
*         description: Insert components in the database using the crawler
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 source:
*                   type: string
*                   enum: [siac]
*                 requested:
*                   type: integer
*                 created:
*                   type: integer
*                 skippedExisting:
*                   type: integer
*                 failed:
*                   type: integer
*                 failures:
*                   type: array
*                   items:
*                     type: string
*                 failureCategories:
*                   type: object
*                   additionalProperties:
*                     type: integer
*       401:
*         description: User is not authorized for import operation
*       400:
*         description: Bad Request
*       500:
*         description: Internal Server Error
*/
componentRouter.post('/import', ensureAuthenticated, ensureAdminAuthenticated, componentController.importComponentsFromSiac);

/**
* @swagger
* /api/components/import/sigaa-public:
*   post:
*     summary: Import components from SIGAA public sources (department or program)
*     tags: [Component]
*     security:
*       - bearerAuth: []
*     requestBody:
*       required: true
*       content:
*         application/json:
*           schema:
*             type: object
*             required:
*               - sourceType
*               - sourceId
*               - academicLevel
*             properties:
*               sourceType:
*                 type: string
*                 enum: [department, program]
*               sourceId:
*                 type: string
*               academicLevel:
*                 type: string
*                 enum: [graduacao, mestrado, doutorado]
*     responses:
*       201:
*         description: Import summary with created, skipped and failed counters
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 source:
*                   type: string
*                   enum: [sigaa-public]
*                 requested:
*                   type: integer
*                 created:
*                   type: integer
*                 skippedExisting:
*                   type: integer
*                 failed:
*                   type: integer
*                 failures:
*                   type: array
*                   items:
*                     type: string
*                 failureCategories:
*                   type: object
*                   additionalProperties:
*                     type: integer
*       400:
*         description: Invalid request payload
*       401:
*         description: User is not authorized for import operation
*       404:
*         description: No components found in provided SIGAA source
*       500:
*         description: Internal Server Error
*/
componentRouter.post('/import/sigaa-public', ensureAuthenticated, ensureAdminAuthenticated, componentController.importComponentsFromSigaaPublic);

componentRouter.post('/import/sigaa-public/jobs', ensureAuthenticated, ensureAdminAuthenticated, componentController.createSigaaPublicImportJob);

componentRouter.get('/import/sigaa-public/jobs', ensureAuthenticated, ensureAdminAuthenticated, componentController.listSigaaPublicImportJobs);

componentRouter.get('/import/sigaa-public/jobs/:jobId', ensureAuthenticated, ensureAdminAuthenticated, componentController.getSigaaPublicImportJob);

componentRouter.post('/import/sigaa-public/jobs/:jobId/cancel', ensureAuthenticated, ensureAdminAuthenticated, componentController.cancelSigaaPublicImportJob);

componentRouter.post('/:id/public-shares', ensureAuthenticated, componentController.createPublicShare);

componentRouter.get('/:id/public-shares', ensureAuthenticated, componentController.getActivePublicShares);

componentRouter.post('/:id/public-shares/revoke-all', ensureAuthenticated, componentController.revokeAllPublicShares);

componentRouter.post('/public-shares/:shareId/revoke', ensureAuthenticated, componentController.revokePublicShare);

componentRouter.get('/:id/export', ensureAuthenticated, componentController.export);

export { componentRouter };
