import nodemailer from 'nodemailer';

type MailContent = string | {
    text: string;
    html?: string;
};

class MailerService{
    private parseBoolean(value: string | undefined, defaultValue: boolean) {
        if (value == undefined) {
            return defaultValue;
        }

        return String(value).trim().toLowerCase() === 'true';
    }

    private hasMailerCredentials() {
        return Boolean(process.env.MAILER_USER && process.env.MAILER_PASSWORD);
    }

    private getTransportConfig() {
        return {
            host: process.env.MAILER_HOST || 'smtp.gmail.com',
            port: Number(process.env.MAILER_PORT || 587),
            secure: this.parseBoolean(process.env.MAILER_SECURE, false),
            requireTLS: this.parseBoolean(process.env.MAILER_REQUIRE_TLS, false),
            connectionTimeout: Number(process.env.MAILER_CONNECTION_TIMEOUT_MS || 10000),
            greetingTimeout: Number(process.env.MAILER_GREETING_TIMEOUT_MS || 10000),
            socketTimeout: Number(process.env.MAILER_SOCKET_TIMEOUT_MS || 15000),
            auth: {
                user: process.env.MAILER_USER,
                pass: process.env.MAILER_PASSWORD,
            },
            tls: {
                rejectUnauthorized: this.parseBoolean(process.env.MAILER_TLS_REJECT_UNAUTHORIZED, false),
            },
        };
    }

    private getFromAddress() {
        return process.env.MAILER_FROM_ADDRESS || process.env.MAILER_USER || 'ementas.ic.ufba@gmail.com';
    }

    private getFromName() {
        return process.env.MAILER_FROM_NAME || 'EMENTAS IC UFBA';
    }

    async execute(to: string, subject: string, content: MailContent){
        const normalizedContent = typeof content === 'string'
            ? { text: content, html: undefined }
            : content;

        const isMailerMockEnabled = this.parseBoolean(process.env.MAILER_MOCK, false);

        if (isMailerMockEnabled || !this.hasMailerCredentials()) {
            const fallbackReason = isMailerMockEnabled
                ? 'MAILER_MOCK=true'
                : 'MAILER_USER/MAILER_PASSWORD ausentes';

            console.log(`[MAILER_MOCK] Email sending skipped (${fallbackReason}).`);
            console.log({
                to,
                subject,
                text: normalizedContent.text,
                html: normalizedContent.html,
            });
            return { deliveryMode: 'mock' as const, fallbackReason };
        }

        const transporter = nodemailer.createTransport(this.getTransportConfig());

        const mailSent = await transporter.sendMail({
            to,
            subject,
            text: normalizedContent.text,
            html: normalizedContent.html,
            from: `${this.getFromName()} <${this.getFromAddress()}>`,
        });

        console.log('Email sent successfully. Message ID:', mailSent.messageId);

        return { deliveryMode: 'sent' as const };
    }

}

export default new MailerService();


