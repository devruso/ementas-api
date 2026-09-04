export enum ApiErrorCode {
    VALIDATION_FAILED = 'VALIDATION_FAILED',
    INTERNAL_ERROR = 'INTERNAL_ERROR',
    ROUTE_NOT_FOUND = 'ROUTE_NOT_FOUND',
    AUTH_CREDENTIALS_REQUIRED = 'AUTH_CREDENTIALS_REQUIRED',
    AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
    AUTH_INSTITUTIONAL_EMAIL_REQUIRED = 'AUTH_INSTITUTIONAL_EMAIL_REQUIRED',
    AUTH_USER_UNAVAILABLE = 'AUTH_USER_UNAVAILABLE',
    AUTH_TOKEN_REQUIRED = 'AUTH_TOKEN_REQUIRED',
    AUTH_SESSION_EXPIRED = 'AUTH_SESSION_EXPIRED',
    AUTH_FORBIDDEN = 'AUTH_FORBIDDEN',
    AUTH_PASSWORD_RESET_INPUT_REQUIRED = 'AUTH_PASSWORD_RESET_INPUT_REQUIRED',
    AUTH_PASSWORD_RESET_LINK_INVALID = 'AUTH_PASSWORD_RESET_LINK_INVALID',
    AUTH_PASSWORD_RESET_DELIVERY_FAILED = 'AUTH_PASSWORD_RESET_DELIVERY_FAILED',
    DRAFT_NOT_FOUND = 'DRAFT_NOT_FOUND',
    DRAFT_CODE_CONFLICT = 'DRAFT_CODE_CONFLICT',
    DRAFT_SAVE_FAILED = 'DRAFT_SAVE_FAILED',
    PUBLICATION_PASSWORD_REQUIRED = 'PUBLICATION_PASSWORD_REQUIRED',
    PUBLICATION_PASSWORD_INVALID = 'PUBLICATION_PASSWORD_INVALID',
    PUBLICATION_REQUIRED_FIELDS = 'PUBLICATION_REQUIRED_FIELDS',
    PUBLICATION_REFERENCES_REQUIRED = 'PUBLICATION_REFERENCES_REQUIRED',
    PUBLICATION_REFERENCE_YEAR_REQUIRED = 'PUBLICATION_REFERENCE_YEAR_REQUIRED',
    PUBLICATION_AGREEMENT_CONFLICT = 'PUBLICATION_AGREEMENT_CONFLICT',
    PUBLICATION_FAILED = 'PUBLICATION_FAILED',
}

export type ApiErrorDefinition = {
    statusCode: number;
    message: string;
    reason?: string;
    recovery?: string;
};

export const API_ERROR_CATALOG: Record<ApiErrorCode, ApiErrorDefinition> = {
    [ApiErrorCode.VALIDATION_FAILED]: {
        statusCode: 400,
        message: 'Existem dados inválidos ou incompletos.',
        reason: 'Um ou mais campos não atendem às regras esperadas pela API.',
        recovery: 'Revise os campos destacados e tente novamente.',
    },
    [ApiErrorCode.INTERNAL_ERROR]: {
        statusCode: 500,
        message: 'Não foi possível concluir a operação.',
        reason: 'O servidor encontrou uma condição inesperada.',
        recovery: 'Tente novamente. Se o erro persistir, informe o horário e a operação realizada.',
    },
    [ApiErrorCode.ROUTE_NOT_FOUND]: {
        statusCode: 404,
        message: 'Recurso não encontrado.',
        reason: 'O endereço solicitado não existe nesta versão da API.',
        recovery: 'Atualize a página ou confirme se frontend e backend estão na mesma versão.',
    },
    [ApiErrorCode.AUTH_CREDENTIALS_REQUIRED]: {
        statusCode: 400,
        message: 'Informe e-mail e senha para continuar.',
        reason: 'A autenticação precisa das duas credenciais.',
        recovery: 'Preencha o e-mail institucional e a senha da conta.',
    },
    [ApiErrorCode.AUTH_INVALID_CREDENTIALS]: {
        statusCode: 401,
        message: 'E-mail ou senha inválidos.',
        reason: 'As credenciais não correspondem a uma conta ativa.',
        recovery: 'Confira os dados ou use a opção de redefinir senha.',
    },
    [ApiErrorCode.AUTH_INSTITUTIONAL_EMAIL_REQUIRED]: {
        statusCode: 400,
        message: 'Use um e-mail institucional da UFBA.',
        reason: 'O acesso é restrito a endereços institucionais autorizados.',
        recovery: 'Informe seu endereço terminado em @ufba.br.',
    },
    [ApiErrorCode.AUTH_USER_UNAVAILABLE]: {
        statusCode: 404,
        message: 'Usuário não encontrado ou inativo.',
        reason: 'A conta foi removida, desativada ou não existe.',
        recovery: 'Solicite ao administrador a reativação da conta, sem criar um cadastro duplicado.',
    },
    [ApiErrorCode.AUTH_TOKEN_REQUIRED]: {
        statusCode: 401,
        message: 'Faça login para continuar.',
        reason: 'A requisição não possui uma sessão autenticada.',
        recovery: 'Entre novamente com seu e-mail institucional e senha.',
    },
    [ApiErrorCode.AUTH_SESSION_EXPIRED]: {
        statusCode: 401,
        message: 'Sua sessão expirou.',
        reason: 'O token de acesso não é mais válido e não pôde ser renovado.',
        recovery: 'Faça login novamente para continuar com segurança.',
    },
    [ApiErrorCode.AUTH_FORBIDDEN]: {
        statusCode: 403,
        message: 'Você não tem permissão para esta operação.',
        reason: 'A conta autenticada não possui o perfil de acesso necessário.',
        recovery: 'Solicite a permissão adequada a um administrador do sistema.',
    },
    [ApiErrorCode.AUTH_PASSWORD_RESET_INPUT_REQUIRED]: {
        statusCode: 400,
        message: 'Informe o link de recuperação e a nova senha.',
        reason: 'A redefinição precisa do token recebido por e-mail e de uma senha válida.',
        recovery: 'Abra novamente o link do e-mail e preencha os dois campos de senha.',
    },
    [ApiErrorCode.AUTH_PASSWORD_RESET_LINK_INVALID]: {
        statusCode: 401,
        message: 'O link de redefinição é inválido ou expirou.',
        reason: 'O token não corresponde a uma solicitação ativa para esta conta.',
        recovery: 'Solicite um novo link na tela Esqueci minha senha.',
    },
    [ApiErrorCode.AUTH_PASSWORD_RESET_DELIVERY_FAILED]: {
        statusCode: 503,
        message: 'Não foi possível enviar o e-mail de recuperação.',
        reason: 'O serviço de e-mail não confirmou o envio da mensagem.',
        recovery: 'Tente solicitar novamente em alguns instantes.',
    },
    [ApiErrorCode.DRAFT_NOT_FOUND]: {
        statusCode: 404,
        message: 'Rascunho não encontrado.',
        reason: 'O rascunho pode ter sido publicado, removido ou atualizado em outra sessão.',
        recovery: 'Recarregue a disciplina antes de continuar.',
    },
    [ApiErrorCode.DRAFT_CODE_CONFLICT]: {
        statusCode: 409,
        message: 'Já existe uma disciplina com esse código.',
        reason: 'Os códigos de disciplina são únicos.',
        recovery: 'Mantenha o código atual ou informe outro código institucional.',
    },
    [ApiErrorCode.DRAFT_SAVE_FAILED]: {
        statusCode: 400,
        message: 'Não foi possível salvar as alterações.',
        reason: 'O servidor não conseguiu persistir o rascunho informado.',
        recovery: 'Revise os dados, recarregue a disciplina se necessário e tente novamente.',
    },
    [ApiErrorCode.PUBLICATION_PASSWORD_REQUIRED]: {
        statusCode: 400,
        message: 'Informe sua senha para confirmar a publicação.',
        reason: 'A publicação oficial exige uma segunda confirmação de identidade.',
        recovery: 'Digite a mesma senha usada para entrar no sistema.',
    },
    [ApiErrorCode.PUBLICATION_PASSWORD_INVALID]: {
        statusCode: 403,
        message: 'Senha incorreta. A publicação não foi realizada.',
        reason: 'A senha de confirmação não corresponde à conta autenticada.',
        recovery: 'Digite novamente sua senha de login ou redefina-a antes de publicar.',
    },
    [ApiErrorCode.PUBLICATION_REQUIRED_FIELDS]: {
        statusCode: 400,
        message: 'A publicação oficial possui campos obrigatórios pendentes.',
        reason: 'O rascunho ainda não contém todo o conteúdo acadêmico necessário.',
        recovery: 'Preencha os campos listados e salve o rascunho antes de publicar.',
    },
    [ApiErrorCode.PUBLICATION_REFERENCES_REQUIRED]: {
        statusCode: 400,
        message: 'Informe ao menos as referências básicas.',
        reason: 'Uma ementa oficial precisa registrar suas referências bibliográficas.',
        recovery: 'Adicione as referências básicas, salve e tente publicar novamente.',
    },
    [ApiErrorCode.PUBLICATION_REFERENCE_YEAR_REQUIRED]: {
        statusCode: 400,
        message: 'Uma referência bibliográfica está sem ano de publicação.',
        reason: 'Referências não web precisam informar o ano para o documento oficial.',
        recovery: 'Inclua o ano nas referências indicadas, salve e tente novamente.',
    },
    [ApiErrorCode.PUBLICATION_AGREEMENT_CONFLICT]: {
        statusCode: 409,
        message: 'A numeração automática da ATA entrou em conflito.',
        reason: 'Outra publicação foi concluída no mesmo instante.',
        recovery: 'Abra a confirmação novamente para receber o próximo número.',
    },
    [ApiErrorCode.PUBLICATION_FAILED]: {
        statusCode: 400,
        message: 'Não foi possível publicar a disciplina.',
        reason: 'A confirmação oficial não pôde ser persistida.',
        recovery: 'O rascunho continua salvo. Recarregue a página e tente novamente.',
    },
};
