import nodemailer from 'nodemailer';

class MailerService{
    private hasMailerCredentials() {
        return Boolean(process.env.MAILER_USER && process.env.MAILER_PASSWORD);
    }

    async execute(to: string, subject: string, text: string){
        const isMailerMockEnabled = process.env.MAILER_MOCK === 'true';

        if (isMailerMockEnabled || !this.hasMailerCredentials()) {
            const fallbackReason = isMailerMockEnabled
                ? 'MAILER_MOCK=true'
                : 'MAILER_USER/MAILER_PASSWORD ausentes';

            console.log(`[MAILER_MOCK] Email sending skipped (${fallbackReason}).`);
            console.log({ to, subject, text });
            return { deliveryMode: 'mock' as const, fallbackReason };
        }

        const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 587,
            secure: false,
            auth: {
                user: process.env.MAILER_USER,
                pass: process.env.MAILER_PASSWORD,
            },
            tls: {
                rejectUnauthorized: false,
            }
        });

        const mailSent = await transporter.sendMail({
            to,
            subject,
            text,
            from: 'EMENTAS-IC-UFBA <ementasicufba@gmail.com>',
        });

        console.log('Password Reset was requested. Message ID: ', mailSent.messageId);

        return { deliveryMode: 'sent' as const };
    }

}

export default new MailerService();


