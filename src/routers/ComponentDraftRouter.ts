import { Router } from 'express';
import { ComponentDraftController } from '../controllers/ComponentDraftController';
import { ApproveDraftRequestDto, CreateDraftRequestDto, UpdateComponentRequestDto } from '../dtos/component';
import { ensureAuthenticated } from '../middlewares/EnsureAuthenticated';
import { uploadDraftImport } from '../middlewares/Upload';
import { makeValidateBody } from '../middlewares/Validator';

const componentDraftRouter = Router();
const componentDraftController = new ComponentDraftController();

/**
* @swagger
* tags:
*   name: ComponentDraft
*   description: The Component Draft managing API
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
*         - code
*         - name
*         - department
*         - status
*         - prerequeriments
*         - semester
*         - syllabus
*         - program
*         - objective
*         - methodology
*         - bibliography
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
*         status:
*           type: string
*           description: Component status
*           enum: [published, draft, archived]
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
*         methodology:
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
*
*     ComponentDraft:
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
*         methodology:
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
*         code: MATA01
*         userId: 50496915-d356-43a0-84a4-43f83bad2225
*         createdAt: 2022-03-18 17:12:52
*         updatedAt: 2022-03-18 17:12:52
*         workloadId: abcdef6
*
*/

/**
* @swagger
* /api/component-drafts:
*   get:
*     summary: Returns the list of all the drafts
*     tags: [ComponentDraft]
*     responses:
*       200:
*         description: The list of all the drafts
*         content:
*           application/json:
*             schema:
*               type: array
*               items:
*                 $ref: '#/components/schemas/ComponentDraft'
*       400:
*         description: Bad Request
*       500:
*         description: Internal Server Error
*/
componentDraftRouter.get('/', ensureAuthenticated, componentDraftController.getDrafts);

componentDraftRouter.post(
    '/import-preview',
    ensureAuthenticated,
    uploadDraftImport.single('file'),
    componentDraftController.importPreview
);

componentDraftRouter.get(
    '/:id/publication-context',
    ensureAuthenticated,
    componentDraftController.getPublicationContext
);

/**
 * @swagger
 * /api/component-drafts/{code}:
 *   get:
 *     summary: Get a draft by code
 *     tags: [ComponentDraft]
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
 *         description: The draft code
 *
 *     responses:
 *       200:
 *         description: The draft was found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               items:
 *                 $ref: '#/components/schemas/ComponentDraft'
 *       400:
 *         description: Bad Request
 *       404:
 *         description: The draft was not found
 *       500:
 *         description: Internal Server Error
 */
componentDraftRouter.get('/:code', ensureAuthenticated, componentDraftController.getDraftByCode);

/**
* @swagger
* /api/component-drafts:
*   post:
*     summary: Create a draft
*     tags: [ComponentDraft]
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
*         name: methodology
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
*         description: The draft has been created
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ContentDraft'
*       400:
*         description: An error has been ocurred.
*/
componentDraftRouter.post('/', ensureAuthenticated, makeValidateBody(CreateDraftRequestDto), componentDraftController.create);

/**
* @swagger
* /api/component-drafts/{id}:
*   put:
*     summary: Update a draft
*     tags: [ComponentDraft]
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
*         name: methodology
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
*         description: The draft has been updated
*         content:
*           application/json:
*             schema:
*               $ref: '#/components/schemas/ComponentDraft'
*       400:
*         description: Bad Request
*       404:
*         description: The draft was not found
*       500:
*         description: Internal Server Error
*/
componentDraftRouter.put('/:id', ensureAuthenticated, makeValidateBody(UpdateComponentRequestDto), componentDraftController.update);

// /**
//  * @swagger
//  * /api/component-drafts/{id}:
//  *   delete:
//  *     summary: Delete a draft by id
//  *     tags: [ComponentDraft]
//  *     parameters:
//  *       - in: header
//  *         name: authenticatedUserId
//  *         schema:
//  *           type: string
//  *         required: true
//  *         description: The authenticated user id
//  *       - in: params
//  *         name: id
//  *         schema:
//  *           type: number
//  *         required: true
//  *         description: The draft id
//  *
//  *     responses:
//  *       200:
//  *         description: The draft was deleted
//  *       400:
//  *         description: Bad Request
//  *       404:
//  *         description: The draft was not found
//  *       500:
//  *         description: Internal Server Error
//  */
// componentDraftRouter.delete('/:id', ensureAuthenticated, componentDraftController.delete);

/**
 * @swagger
 * /api/component-drafts/{id}/approve:
 *   post:
 *     summary: Approve a draft
 *     tags: [ComponentDraft]
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
 *         description: The draft id
 *       - in: body
 *         name: agreementDate
 *         schema:
 *           type: date
 *         required: true
 *         description: The date of the meeting in which the draft was approved
 *       - in: body
 *         name: agreementNumber
 *         schema:
 *           type: number
 *         required: true
 *         description: The identification number of the meeting in which the draft was approved
 *
 *     responses:
 *       200:
 *         description: The draft was approved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ComponentDraft'
 *       400:
 *         description: Bad Request
 *       404:
 *         description: The component was not found
 *       500:
 *         description: Internal Server Error
 */
componentDraftRouter.post('/:id/approve', ensureAuthenticated, makeValidateBody(ApproveDraftRequestDto), componentDraftController.approve);

export { componentDraftRouter };
