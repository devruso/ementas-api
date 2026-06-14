const url = process.env.SWAGGER_SERVER_URL
    ? String(process.env.SWAGGER_SERVER_URL).trim().replace(/\/+$/, '')
    : process.env.NODE_ENV === 'production'
        ? `http://localhost:${process.env.PORT || 3333}`
        : `http://localhost:${process.env.PORT || 3333}`;

const SwaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Banco de ConteÃºdos ProgramÃ¡ticos',
            description: 'Banco de ConteÃºdos ProgramÃ¡ticos das disciplinas ofertadas pelos cursos da UFBA.',
            version: '1.0.0',
        },
        servers: [
            {
                url,
            },
        ],
    },
    apis: [ './src/routers/*.{js,ts}' ]
};

export { SwaggerOptions };


