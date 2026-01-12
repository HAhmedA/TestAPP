import swaggerJsdoc from 'swagger-jsdoc'

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'SurveyJS React Client API',
            version: '1.0.0',
            description: 'API documentation for the SurveyJS React Client backend',
        },
        servers: [
            {
                url: '/api',
                description: 'Development server',
            },
        ],
        components: {
            securitySchemes: {
                cookieAuth: {
                    type: 'apiKey',
                    in: 'cookie',
                    name: 'connect.sid',
                },
            },
        },
        security: [
            {
                cookieAuth: [],
            },
        ],
    },
    apis: ['./routes/*.js', './controllers/*.js'], // Files containing annotations
}

export const specs = swaggerJsdoc(options)
