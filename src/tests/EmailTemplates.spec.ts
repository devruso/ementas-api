import { buildResetPasswordEmailTemplate } from '../helpers/emailTemplates';

describe('Email templates', () => {
    it('should include system access link and stable logo in reset password email', () => {
        process.env.APP_PUBLIC_URL = 'https://ementas.app.ic.ufba.br';
        delete process.env.EMAIL_LOGO_URL;

        const template = buildResetPasswordEmailTemplate('abc123');

        expect(template.text).toContain('Acesse o sistema: https://ementas.app.ic.ufba.br');
        expect(template.html).toContain('Acessar sistema');
        expect(template.html).toContain('https://ementas.app.ic.ufba.br');
        expect(template.html).toContain('https://sipac.ufba.br/shared/img/instituicao/brasao_ufba48x75.jpg');
    });
});
