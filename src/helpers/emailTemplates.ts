const escapeHtml = (value: string) =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const resolveSystemBaseUrl = () => {
    return String(
        process.env.APP_PUBLIC_URL
        || process.env.FRONTEND_BASE_URL
        || process.env.FRONTEND_URL
        || 'https://ementas.app.ic.ufba.br'
    ).trim().replace(/\/+$/, '');
};

const resolveEmailLogoUrl = () => {
    return String(
        process.env.EMAIL_LOGO_URL
        || 'https://sipac.ufba.br/shared/img/instituicao/brasao_ufba48x75.jpg'
    ).trim();
};

const renderBaseTemplate = (title: string, headline: string, intro: string, contentHtml: string, footerNote?: string) => {
    const safeTitle = escapeHtml(title);
    const safeHeadline = escapeHtml(headline);
    const safeIntro = escapeHtml(intro);

    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background:#f3f6fb;font-family:Segoe UI,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;background:#f3f6fb;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #dbe5ff;">
          <tr>
            <td style="padding:22px 24px;background:linear-gradient(120deg,#ffffff 0%,#eaf1ff 45%,#2f67c8 100%);">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:12px;">
                    <img src="${escapeHtml(resolveEmailLogoUrl())}" alt="Instituto de Computação UFBA" width="44" height="44" style="display:block;border-radius:50%;background:#fff;" />
                  </td>
                  <td style="vertical-align:middle;">
                    <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:#1d4b9c;">Instituto de Computação</div>
                    <div style="font-size:22px;line-height:1.2;font-weight:700;color:#1f3f7d;">Ementas</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:26px 24px 18px;">
              <h1 style="margin:0 0 10px;font-size:26px;line-height:1.2;color:#1f2937;">${safeHeadline}</h1>
              <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#374151;">${safeIntro}</p>
              ${contentHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;color:#6b7280;font-size:13px;line-height:1.7;">
              ${footerNote ? `<p style="margin:0 0 8px;">${escapeHtml(footerNote)}</p>` : ''}
              <p style="margin:0;">Equipe Ementas • Instituto de Computação UFBA</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

export const buildInviteEmailTemplate = (inviteLink: string) => {
    const safeInviteLink = escapeHtml(inviteLink);

    return {
        text: `Olá,\n\nVocê recebeu um convite para cadastro no Ementas.\n\nAcesse o link:\n${inviteLink}\n\nEste convite expira em 24 horas.\n\nEquipe Ementas`,
        html: renderBaseTemplate(
            'Convite para cadastro - Ementas',
            'Convite institucional',
            'Você recebeu um convite para criar sua conta no sistema Ementas.',
            `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">Clique no botão abaixo para concluir seu cadastro:</p>
             <p style="margin:0 0 20px;">
               <a href="${safeInviteLink}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 20px;background:#2f67c8;color:#ffffff;text-decoration:none;font-weight:700;border-radius:12px;">Criar conta</a>
             </p>
             <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#6b7280;">Se o botão não abrir, use este link:</p>
             <p style="margin:0;font-size:13px;line-height:1.6;"><a href="${safeInviteLink}" target="_blank" rel="noopener noreferrer" style="color:#1d4b9c;word-break:break-all;">${safeInviteLink}</a></p>`,
            'Este convite expira em 24 horas.'
        ),
    };
};

export const buildTeacherCredentialsEmailTemplate = (teacherName: string, email: string, temporaryPassword: string, actorName: string) => {
    const safeTeacherName = escapeHtml(teacherName);
    const safeEmail = escapeHtml(email);
    const safePassword = escapeHtml(temporaryPassword);
    const safeActorName = escapeHtml(actorName);

    return {
        text: `Olá ${teacherName},\n\nSeu acesso ao Ementas foi criado por ${actorName}.\n\nE-mail: ${email}\nSenha provisória: ${temporaryPassword}\n\nAo entrar, altere sua senha imediatamente.\n\nEquipe Ementas`,
        html: renderBaseTemplate(
            'Credenciais iniciais - Ementas',
            `Olá, ${teacherName}`,
            `Seu acesso foi criado por ${actorName}.`,
            `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:separate;border-spacing:0 10px;">
               <tr>
                 <td style="font-size:14px;color:#4b5563;">E-mail institucional</td>
                 <td style="font-size:14px;font-weight:600;color:#1f2937;">${safeEmail}</td>
               </tr>
               <tr>
                 <td style="font-size:14px;color:#4b5563;">Senha provisória</td>
                 <td style="font-size:14px;font-weight:700;color:#1f2937;">${safePassword}</td>
               </tr>
             </table>
             <p style="margin:16px 0 0;padding:12px 14px;border-radius:12px;background:#eef4ff;color:#1f3f7d;font-size:14px;line-height:1.6;">Por segurança, altere sua senha no primeiro acesso.</p>`,
            undefined
        ),
    };
};

export const buildResetPasswordEmailTemplate = (temporaryPassword: string) => {
    const safePassword = escapeHtml(temporaryPassword);
  const systemUrl = resolveSystemBaseUrl();
  const safeSystemUrl = escapeHtml(systemUrl);

    return {
    text: `Olá,\n\nSua senha do Ementas foi redefinida.\n\nNova senha provisória: ${temporaryPassword}\n\nAcesse o sistema: ${systemUrl}\n\nRecomendamos alterar a senha após o login.\n\nEquipe Ementas`,
        html: renderBaseTemplate(
            'Recuperação de senha - Ementas',
            'Senha redefinida',
            'Recebemos sua solicitação de recuperação de senha.',
            `<p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:#374151;">Sua nova senha provisória é:</p>
             <p style="margin:0 0 18px;padding:12px 14px;border-radius:12px;background:#f3f4f6;color:#111827;font-size:16px;font-weight:700;letter-spacing:0.02em;">${safePassword}</p>
       <p style="margin:0 0 16px;">
         <a href="${safeSystemUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 20px;background:#2f67c8;color:#ffffff;text-decoration:none;font-weight:700;border-radius:12px;">Acessar sistema</a>
       </p>
       <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#6b7280;">Se o botão não abrir, use este link:</p>
       <p style="margin:0 0 18px;font-size:13px;line-height:1.6;"><a href="${safeSystemUrl}" target="_blank" rel="noopener noreferrer" style="color:#1d4b9c;word-break:break-all;">${safeSystemUrl}</a></p>
             <p style="margin:0;font-size:14px;line-height:1.6;color:#4b5563;">Depois de entrar no sistema, altere sua senha por segurança.</p>`,
            undefined
        ),
    };
};