import { buildResetPasswordEmailTemplate } from '../helpers/emailTemplates';

describe('Email templates', () => {
    it('should include system access link and stable logo in reset password email', () => {
        delete process.env.EMAIL_LOGO_URL;

        const template = buildResetPasswordEmailTemplate('https://ementas.app.ic.ufba.br/novasenha/token-123');

        expect(template.text).toContain('Acesse o link abaixo para criar uma nova senha:');
        expect(template.html).toContain('Redefinir senha');
        expect(template.html).toContain('https://ementas.app.ic.ufba.br/novasenha/token-123');
        expect(template.html).toContain('https://sipac.ufba.br/shared/img/instituicao/brasao_ufba48x75.jpg');
    });
});
