import AdmZip from 'adm-zip';

type SessionResponse = {
    token?: string;
    accessToken?: string;
};

const getArgValue = (flagName: string) => {
    const prefix = `${flagName}=`;
    const directMatch = process.argv.slice(2).find((arg) => arg.startsWith(prefix));

    if (directMatch) {
        return directMatch.slice(prefix.length).trim();
    }

    const flagIndex = process.argv.indexOf(flagName);

    if (flagIndex >= 0 && process.argv[flagIndex + 1]) {
        return process.argv[flagIndex + 1].trim();
    }

    return undefined;
};

const hasFlag = (flagName: string) =>
    process.argv.slice(2).some((arg) => arg === flagName || arg.startsWith(`${flagName}=`));

const requestJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, init);
    const rawText = await response.text();

    let parsed: unknown = {};

    if (rawText) {
        try {
            parsed = JSON.parse(rawText);
        } catch {
            parsed = { rawText };
        }
    }

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${JSON.stringify(parsed)}`);
    }

    return parsed as T;
};

const requestBinary = async (url: string, init?: RequestInit) => {
    const response = await fetch(url, init);
    const arrayBuffer = await response.arrayBuffer();

    if (!response.ok) {
        const bodyText = Buffer.from(arrayBuffer).toString('utf-8');
        throw new Error(`HTTP ${response.status} ${response.statusText}: ${bodyText}`);
    }

    return {
        contentType: response.headers.get('content-type') || '',
        content: Buffer.from(arrayBuffer),
    };
};

async function main() {
    const baseUrl = (getArgValue('--baseUrl') || process.env.API_BASE_URL || 'http://127.0.0.1:3333').replace(/\/+$/, '');
    const componentId = getArgValue('--componentId') || process.env.SIGNATURE_TEST_COMPONENT_ID;
    const expectedApproverName = getArgValue('--expectedApproverName') || process.env.SIGNATURE_TEST_APPROVER_NAME;
    const providedToken = getArgValue('--token') || process.env.SIGNATURE_TEST_TOKEN;
    const email = getArgValue('--email') || process.env.SIGNATURE_TEST_EMAIL;
    const password = getArgValue('--password') || process.env.SIGNATURE_TEST_PASSWORD;

    if (hasFlag('--skipTlsValidation')) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    if (!componentId) {
        throw new Error('Informe --componentId para validar o DOCX exportado.');
    }

    let token = String(providedToken || '').trim();

    if (!token) {
        if (!email || !password) {
            throw new Error('Informe --token ou use --email e --password para validar a exportacao DOCX.');
        }

        console.log('[signature-docx-flow] logging in', {
            baseUrl,
            email,
        });

        const session = await requestJson<SessionResponse>(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
        });

        token = String(session.accessToken || session.token || '').trim();

        if (!token) {
            throw new Error('Resposta de login nao retornou token/accessToken.');
        }
    } else {
        console.log('[signature-docx-flow] using provided token', {
            baseUrl,
        });
    }

    console.log('[signature-docx-flow] downloading docx export', {
        componentId,
    });

    const exportedDocx = await requestBinary(`${baseUrl}/api/components/${componentId}/export?format=docx`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    if (!/application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/i.test(exportedDocx.contentType)) {
        throw new Error(`Export retornou content-type inesperado: ${exportedDocx.contentType}`);
    }

    const zip = new AdmZip(exportedDocx.content);
    const documentXml = zip.readAsText('word/document.xml');
    const hasEmbeddedTeacherSignatureAsset = zip
        .getEntries()
        .some((entry: { entryName: string }) => /^word\/media\/signature-rId\d+\.png$/.test(entry.entryName));

    if (!hasEmbeddedTeacherSignatureAsset) {
        throw new Error('DOCX exportado nao contem asset de assinatura embutido em word/media/signature-rId*.png.');
    }

    if (!/<w:drawing|<w:pict/.test(documentXml)) {
        throw new Error('DOCX exportado nao contem drawing/pict para a assinatura do professor.');
    }

    if (expectedApproverName && !documentXml.includes(`Nome: ${expectedApproverName} Assinatura:`)) {
        throw new Error(`DOCX exportado nao contem a linha esperada para o aprovador "${expectedApproverName}".`);
    }

    console.log('[signature-docx-flow] success', {
        componentId,
        contentType: exportedDocx.contentType,
        hasEmbeddedTeacherSignatureAsset,
        expectedApproverName: expectedApproverName || undefined,
    });
}

main().catch((error) => {
    const details = error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: String(error) };

    console.error('[signature-docx-flow] failed', details);
    process.exit(1);
});
