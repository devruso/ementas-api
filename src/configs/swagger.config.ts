const url = process.env.NODE_ENV === 'production'
    ? 'https://api-ementas.herokuapp.com/'
    : `http://localhost:${process.env.PORT}`;

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


