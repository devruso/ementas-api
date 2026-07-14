# Application Programming Interface
## Database System of Syllabus of the Subjects of the Federal University of Bahia

# Get Starded

## Install dependencies
```sh
npm install
```

## Enviroments
Make sure to create a `.env` in the root level on your local machine beforehand. Check the existing variables at `./.env.example`

### Mailer (SMTP com Gmail para producao)

- O sistema funciona sem SMTP real em ambiente de desenvolvimento.
- Quando `MAILER_MOCK=true`, o envio de e-mail é simulado (logado no backend) e o fluxo de convite/cadastro continua normalmente.
- Mesmo com `MAILER_MOCK=false`, se `MAILER_USER`/`MAILER_PASSWORD` não estiverem definidos, o backend entra em fallback mock automaticamente.
- Para envio real, defina `MAILER_USER` e `MAILER_PASSWORD` válidos e use `MAILER_MOCK=false`.
- Para Gmail, use uma App Password da conta `ementas.ic.ufba@gmail.com`; nao use a senha normal da conta.

Variaveis recomendadas para producao:

```sh
MAILER_HOST=smtp.gmail.com
MAILER_PORT=587
MAILER_SECURE=false
MAILER_TLS_REJECT_UNAUTHORIZED=false
MAILER_USER=ementas.ic.ufba@gmail.com
MAILER_PASSWORD=<gmail-app-password>
MAILER_FROM_NAME=EMENTAS IC UFBA
MAILER_FROM_ADDRESS=ementas.ic.ufba@gmail.com
MAILER_MOCK=false
```

Observacoes operacionais:

- A conta Gmail do projeto passa a ser o remetente padrao de convites e recuperacao de senha.
- O throughput diario do Gmail e limitado; para o volume atual de convites do TCC, o limite eh suficiente, mas monitore bloqueios e spam.
- Se `MAILER_MOCK=true`, o backend nao envia e-mail real mesmo com credenciais preenchidas.

### Variaveis de runtime e operacao

Variaveis adicionais relevantes em producao:

```sh
SWAGGER_SERVER_URL=https://api.ementas.app.ic.ufba.com.br
LIBREOFFICE_BIN=/usr/bin/libreoffice
PDF_CONVERSION_TIMEOUT_MS=45000
SUPER_ADMIN_EMAIL=<email-institucional-ufba>
SUPER_ADMIN_NAME=Super Admin
SUPER_ADMIN_PASSWORD=<senha-forte-inicial>
CRAWLER_HTTP_TIMEOUT_MS=45000
```

Observacoes:

- `SWAGGER_SERVER_URL` evita que a documentacao da API publique uma URL incorreta no ambiente produtivo.
- `SUPER_ADMIN_*` pode ser usado junto com `npm run user:ensure-super-admin` para bootstrap administrativo.
- Se o crawler SIGAA funcionar localmente, mas expirar no servidor, teste `CRAWLER_HTTP_FAMILY=4` para forcar IPv4 e compare os logs `[sigaa-request-failed]` em producao.

### Storage de arquivos (incremental)

- O backend agora possui contrato de provider de storage com seleção por variável de ambiente.
- Modo padrão: `STORAGE_PROVIDER=local`.
- O provider local persiste arquivos no caminho definido por `STORAGE_LOCAL_BASE_PATH` (padrão: `storage`).
- O contrato S3-compatible já está preparado, mas fica desativado por padrão para reduzir risco operacional no TCC.

Variáveis relevantes:

```sh
STORAGE_PROVIDER=local
STORAGE_LOCAL_BASE_PATH=storage
STORAGE_S3_ENABLED=false
STORAGE_S3_ENDPOINT=
STORAGE_S3_REGION=us-east-1
STORAGE_S3_BUCKET=
STORAGE_S3_ACCESS_KEY_ID=
STORAGE_S3_SECRET_ACCESS_KEY=
STORAGE_S3_FORCE_PATH_STYLE=true
STORAGE_S3_PUBLIC_BASE_URL=
```

Observações:

- Não salve arquivos no filesystem efêmero do container sem volume.
- Em Docker Compose deste projeto, o volume `api_storage` monta `/app/storage` para persistência local.
- Para migrar para serviço da universidade compatível com S3, mantenha `STORAGE_PROVIDER=s3` apenas quando `STORAGE_S3_ENABLED=true` e as credenciais estiverem configuradas.
- Se `STORAGE_S3_REGION` não for informado, o backend faz fallback para `us-east-1`, que costuma ser o valor esperado em MinIO.
- Para validar a configuração dentro do container antes de testar a UI, rode `npm run storage:smoke-test`.

### Assinatura do professor (texto + arquivo)

- Endpoint textual existente: `PUT /api/users/update/signature` com payload JSON `{ "signature": "..." }`.
- Novo endpoint multipart: `PUT /api/users/update/signature/file` com campo `signatureFile` e campo opcional `signature`.
- O upload persiste metadados no usuário e mantém compatibilidade com validação de assinatura hash para publicação oficial.

Campos persistidos em `users`:

- `signature_hash`
- `signature_updated_at`
- `signature_file_key`
- `signature_file_provider`
- `signature_file_content_type`
- `signature_file_size`
- `signature_file_hash`

### Convite por e-mail (admin)

- Rota: `POST /api/users/invite-email`
- Autorização: usuário autenticado com papel `admin` ou `super_admin`.
- Payload:

```json
{
	"email": "jamilsonj@ufba.br",
	"registrationBaseUrl": "http://localhost:3000"
}
```

- Resultado: gera token de convite, cria shortlink `/i/{codigo}` com expiração em 24h e envia por e-mail (ou mock/fallback quando SMTP não estiver ativo).
- Resolucao do shortlink: `GET /api/invite/resolve/{codigo}` retorna o `inviteToken` original para redirecionar ao cadastro.
- Limpeza automatica: links expirados sao removidos no startup e periodicamente (padrao: a cada 6 horas). Ajuste com `INVITE_SHORTLINK_CLEANUP_INTERVAL_MS`.
- Limpeza manual sob demanda: `npm run invite:cleanup`.

## Postgresql
Run `npm run postgres:create` to create and run a docker image for a Postgres server.

If you use `docker compose`, the local PostgreSQL port exposed by this project is `15432` to avoid conflicts with a host PostgreSQL already running on `5432`.

## Test Database
Make sure `DB_TEST_NAME` exists before running tests. With Docker Compose, you can create it with:

```sh
docker exec ementas-api-postgres-1 psql -U admin -d postgres -c "CREATE DATABASE testdatabase;"
```

## Migrations
### Running migrations
Run `npm run migration:run` in order to execute the migrations locally. Although is worth mentioning that `npm run dev` will run the migrations too.
### Reverting migrations
Run `npm run migration:revert` to revert all migrations.
### Generate migrations
Run `npm run migration:generate migration_name` to generate a new migration based in changes made on entities. Make sure to run `migration:run` before that to keep the migration in order and avoid issues.
### Create migration
Run `npm run migration:create migration_name` in order to manually create migrations. This will create a template migration file that can be used to make changes in the database that doesn't require a change in the entities, for example: inserting data, installing plugins, create new users etc.

## Development database reset

When you need to rebuild the local database from scratch during development:

```sh
npm run db:reset:dev
```

This command drops and recreates schema `public`, then reapplies migrations.

## Automatic import on startup (empty database)

If you want the API to automatically import components when starting with an empty `components` table, enable the startup bootstrap vars in `.env`:

```sh
BOOTSTRAP_IMPORT_ON_EMPTY_DB=true
BOOTSTRAP_IMPORT_SOURCE=sigaa-public
BOOTSTRAP_ADMIN_EMAIL=jamilsonj@ufba.br
BOOTSTRAP_ADMIN_NAME=Jamilson
BOOTSTRAP_ADMIN_PASSWORD=Ementas@2026
BOOTSTRAP_SIGAA_SOURCE_TYPE=department
BOOTSTRAP_SIGAA_ACADEMIC_LEVEL=graduacao
CRAWLER_HTTP_FAMILY=4
```

Notes:

- Import runs only when `components` is empty.
- The bootstrap user is created/promoted as `super_admin` automatically for the operation.
- For SIAC source, set `BOOTSTRAP_IMPORT_SOURCE=siac` and provide `BOOTSTRAP_SIAC_CD_CURSO` plus `BOOTSTRAP_SIAC_NU_PER_CURSO_INICIAL`.
- For an offline production bootstrap generated locally, set `BOOTSTRAP_IMPORT_SOURCE=sigaa-snapshot` and provide `BOOTSTRAP_SIGAA_SNAPSHOT_PATH`.
- `CRAWLER_HTTP_FAMILY=4` is optional and helps when production networking reaches SIGAA over IPv4 but times out over IPv6.
- For SIGAA public source, the bootstrap now accepts both single-value vars such as `BOOTSTRAP_SIGAA_SOURCE_ID_GRADUACAO` and multi-value vars such as `BOOTSTRAP_SIGAA_SOURCE_IDS_GRADUACAO`, comma-separated.
- Validated IC/UFBA public units found in the fixtures:
  - `1118`: colegiado de Ciencia da Computacao
  - `1935`: colegiado de Sistemas de Informacao
  - `1934`: colegiado de Licenciatura em Computacao
  - `1114`: Departamento de Ciencia da Computacao
  - `2440`: Departamento de Computacao Interdisciplinar
  - `1820`: PGCOMP (mestrado/stricto)
- Doutorado SIGAA publico still depends on a source with public offer actually available. If you do not have a validated doctoral source id, omit `BOOTSTRAP_SIGAA_SOURCE_IDS_DOUTORADO` and the bootstrap skips that level by default.

Example for IC graduation colegiados plus PGCOMP:

```sh
BOOTSTRAP_IMPORT_ON_EMPTY_DB=true
BOOTSTRAP_IMPORT_SOURCE=sigaa-public
BOOTSTRAP_ADMIN_EMAIL=seu-email@ufba.br
BOOTSTRAP_ADMIN_NAME=Seu Nome
BOOTSTRAP_ADMIN_PASSWORD=sua-senha-forte
BOOTSTRAP_SIGAA_SOURCE_TYPE=department
BOOTSTRAP_SIGAA_ACADEMIC_LEVEL=all
BOOTSTRAP_SIGAA_SOURCE_IDS_GRADUACAO=1118,1935,1934
BOOTSTRAP_SIGAA_SOURCE_IDS_MESTRADO=1820
CRAWLER_HTTP_FAMILY=4
```

Offline snapshot flow when Dokku cannot reach SIGAA:

```sh
npm run sigaa:bootstrap-snapshot -- \
  --graduacaoSourceIds=1118,1935,1934 \
  --mestradoSourceIds=1820 \
  --output=bootstrap-data/sigaa-bootstrap.snapshot.json
```

Then deploy with:

```sh
BOOTSTRAP_IMPORT_ON_EMPTY_DB=true
BOOTSTRAP_IMPORT_SOURCE=sigaa-snapshot
BOOTSTRAP_ADMIN_EMAIL=seu-email@ufba.br
BOOTSTRAP_ADMIN_NAME=Seu Nome
BOOTSTRAP_ADMIN_PASSWORD=sua-senha-forte
BOOTSTRAP_SIGAA_SNAPSHOT_PATH=/app/bootstrap-data/sigaa-bootstrap.snapshot.json
BOOTSTRAP_SIGAA_ACADEMIC_LEVEL=all
BOOTSTRAP_SIGAA_SOURCE_IDS_GRADUACAO=1118,1935,1934
BOOTSTRAP_SIGAA_SOURCE_IDS_MESTRADO=1820
```

## SIGAA reconciliation for existing components

To reconcile already imported components with richer SIGAA metadata (including prerequisites) without hardcoded course rules:

```sh
npm run sigaa:reconcile -- --sourceType=department --sourceId=1114 --academicLevel=graduacao
```

Optional operator selection by e-mail:

```sh
npm run sigaa:reconcile -- --sourceType=program --sourceId=1820 --academicLevel=mestrado --userEmail=admin@ufba.br
```

## SIAC reconciliation for existing components

To import/reconcile components by curriculum course (usually richer in prerequisites):

```sh
npm run siac:reconcile -- --cdCurso=112140 --nuPerCursoInicial=20111
```

Optional operator selection by e-mail:

```sh
npm run siac:reconcile -- --cdCurso=112140 --nuPerCursoInicial=20111 --userEmail=admin@ufba.br
```

## DOCX template for export

- The API uses a canonical DOCX template to generate all official exported documents.
- Required file name: `UFBA_TEMPLATE.docx` in the API root folder.
- If the template is missing, export fails with explicit server error.

### Recommended placeholders for higher fidelity

To preserve UFBA crest, fonts and layout, edit only text placeholders in the DOCX template and keep style definitions untouched:

- `{{COMPONENT_CODE}}`
- `{{COMPONENT_NAME}}`
- `{{DEPARTMENT}}`
- `{{SEMESTER}}`
- `{{PREREQUERIMENTS}}`
- `{{SYLLABUS}}`
- `{{OBJECTIVE}}`
- `{{PROGRAM}}`
- `{{METHODOLOGY}}`
- `{{LEARNING_ASSESSMENT}}`
- `{{BIBLIOGRAPHY}}`

Backend field mapping used in export:

- `component.code -> {{COMPONENT_CODE}}`
- `component.name -> {{COMPONENT_NAME}}`
- `component.department -> {{DEPARTMENT}}`
- `component.semester -> {{SEMESTER}}`
- `component.prerequeriments -> {{PREREQUERIMENTS}}`
- `component.syllabus -> {{SYLLABUS}}`
- `component.objective -> {{OBJECTIVE}}`
- `component.program -> {{PROGRAM}}`
- `component.methodology -> {{METHODOLOGY}}`
- `component.learningAssessment -> {{LEARNING_ASSESSMENT}}`
- `component.bibliography -> {{BIBLIOGRAPHY}}`

## PDF export runtime

- Official PDF is generated strictly from the official DOCX (template-first) to preserve layout fidelity.
- Required converter: LibreOffice (headless) available in host/container.
- If LibreOffice is unavailable, PDF export returns error (no HTML fallback) to avoid fidelity drift.

### Production/Container notes

- Recommended runtime base image: Debian slim with LibreOffice installed.
- Environment variables:
	- `LIBREOFFICE_BIN` (default in Dockerfile: `/usr/bin/libreoffice`)
	- `PDF_CONVERSION_TIMEOUT_MS` (default: `45000`)
- Conversion runs with an isolated LibreOffice user profile per request to reduce cross-request interference and improve reproducibility.

## Run lint
```sh
npm run lint:check
```

## Fix lint errors (if applicable)
```sh
npm run lint:fix
```

## Run typecheck (compile the .ts into .js without creating the dist/ folder)
```sh
npm run typecheck
```

## Start project locally
```sh
npm run dev
```


