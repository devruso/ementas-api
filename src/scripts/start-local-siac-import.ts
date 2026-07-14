import * as http from 'http';

function getArgValue(flag: string): string | undefined {
    const match = process.argv.find((arg) => arg.startsWith(`${flag}=`));
    return match ? match.slice(flag.length + 1) : undefined;
}

function normalizeBaseUrl(rawValue?: string) {
    return String(rawValue || 'http://127.0.0.1:3333').trim().replace(/\/+$/, '');
}

function requestJson<T>(
    method: 'GET' | 'POST',
    targetUrl: string,
    options?: {
        headers?: Record<string, string>;
        body?: unknown;
    }
): Promise<T> {
    return new Promise((resolve, reject) => {
        const url = new URL(targetUrl);
        const payload = options?.body == null ? undefined : JSON.stringify(options.body);

        const req = http.request({
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port,
            path: `${url.pathname}${url.search}`,
            method,
            headers: {
                Accept: 'application/json',
                ...(payload ? {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload).toString(),
                } : {}),
                ...(options?.headers || {}),
            },
        }, (res) => {
            const chunks: Buffer[] = [];

            res.on('data', (chunk) => {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });

            res.on('end', () => {
                const rawBody = Buffer.concat(chunks).toString('utf8');
                const statusCode = Number(res.statusCode || 0);

                if (statusCode < 200 || statusCode >= 300) {
                    return reject(new Error(`HTTP ${statusCode}: ${rawBody || 'Unexpected error.'}`));
                }

                try {
                    resolve((rawBody ? JSON.parse(rawBody) : {}) as T);
                } catch {
                    reject(new Error(`Failed to parse JSON response: ${rawBody}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy(new Error(`Timeout while requesting ${targetUrl}`));
        });

        if (payload) {
            req.write(payload);
        }

        req.end();
    });
}

async function main() {
    const email = String(getArgValue('--email') || '').trim().toLowerCase();
    const password = String(getArgValue('--password') || '');
    const cdCurso = String(getArgValue('--cdCurso') || '').trim();
    const nuPerCursoInicial = String(getArgValue('--nuPerCursoInicial') || '').trim();
    const baseUrl = normalizeBaseUrl(getArgValue('--baseUrl'));

    if (!email) {
        throw new Error('Missing --email argument.');
    }

    if (!password) {
        throw new Error('Missing --password argument.');
    }

    if (!cdCurso) {
        throw new Error('Missing --cdCurso argument.');
    }

    if (!nuPerCursoInicial) {
        throw new Error('Missing --nuPerCursoInicial argument.');
    }

    const status = await requestJson<{ ok: boolean }>('GET', `${baseUrl}/api/status`);

    if (!status.ok) {
        throw new Error('API status endpoint did not return ok=true.');
    }

    const loginResponse = await requestJson<{ token?: string }>('POST', `${baseUrl}/api/auth/login`, {
        body: { email, password },
    });

    const token = String(loginResponse.token || '').trim();

    if (!token) {
        throw new Error('Login did not return a token.');
    }

    const summary = await requestJson<unknown>('POST', `${baseUrl}/api/components/import`, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
        body: {
            cdCurso,
            nuPerCursoInicial,
        },
    });

    console.log(JSON.stringify({
        ok: true,
        stage: 'siac-import-finished',
        parameters: {
            cdCurso,
            nuPerCursoInicial,
        },
        summary,
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
