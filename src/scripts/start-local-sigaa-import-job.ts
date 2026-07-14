import * as http from 'http';

type AcademicLevel = 'graduacao' | 'mestrado' | 'doutorado' | 'all';
type SourceType = 'department' | 'program';

function getArgValue(flag: string): string | undefined {
    const match = process.argv.find((arg) => arg.startsWith(`${flag}=`));
    return match ? match.slice(flag.length + 1) : undefined;
}

function getBooleanArg(flag: string, fallback = false) {
    const rawValue = getArgValue(flag);

    if (!rawValue) {
        return fallback;
    }

    return /^(true|1|yes|on)$/i.test(rawValue);
}

function getNumberArg(flag: string, fallback: number) {
    const rawValue = Number(getArgValue(flag) || fallback);

    if (!Number.isFinite(rawValue)) {
        return fallback;
    }

    return Math.floor(rawValue);
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
                } catch (error) {
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
    const baseUrl = normalizeBaseUrl(getArgValue('--baseUrl'));
    const sourceType = (getArgValue('--sourceType') || 'department') as SourceType;
    const academicLevel = (getArgValue('--academicLevel') || 'all') as AcademicLevel;
    const sourceId = String(getArgValue('--sourceId') || '').trim();
    const graduacaoSourceId = String(getArgValue('--graduacaoSourceId') || '').trim();
    const mestradoSourceId = String(getArgValue('--mestradoSourceId') || '').trim();
    const doutoradoSourceId = String(getArgValue('--doutoradoSourceId') || '').trim();
    const batchSize = Math.max(1, getNumberArg('--batchSize', 20));
    const requestTimeoutMs = Math.max(1000, getNumberArg('--requestTimeoutMs', 120000));
    const pollIntervalSeconds = Math.max(2, getNumberArg('--pollIntervalSeconds', 10));
    const enrichDetails = getBooleanArg('--enrichDetails', false);

    if (!email) {
        throw new Error('Missing --email argument.');
    }

    if (!password) {
        throw new Error('Missing --password argument.');
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

    const sourceIdsByLevel: Record<string, string> = {};

    if (graduacaoSourceId) {
        sourceIdsByLevel.graduacao = graduacaoSourceId;
    }

    if (mestradoSourceId) {
        sourceIdsByLevel.mestrado = mestradoSourceId;
    }

    if (doutoradoSourceId) {
        sourceIdsByLevel.doutorado = doutoradoSourceId;
    }

    const payload: Record<string, unknown> = {
        sourceType,
        academicLevel,
        batchSize,
        requestTimeoutMs,
        enrichDetails,
    };

    if (sourceId) {
        payload.sourceId = sourceId;
    }

    if (Object.keys(sourceIdsByLevel).length > 0) {
        payload.sourceIdsByLevel = sourceIdsByLevel;
    }

    const jobResponse = await requestJson<{
        message?: string;
        job?: { id?: string; status?: string };
    }>('POST', `${baseUrl}/api/components/import/sigaa-public/jobs`, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
        body: payload,
    });

    const jobId = String(jobResponse.job?.id || '').trim();

    if (!jobId) {
        throw new Error('Import job was not created.');
    }

    console.log(JSON.stringify({
        ok: true,
        stage: 'job-created',
        message: jobResponse.message || '',
        jobId,
        status: jobResponse.job?.status || 'unknown',
        payload,
    }, null, 2));

    while (true) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalSeconds * 1000));

        const job = await requestJson<{
            id: string;
            status: string;
            progress?: {
                currentLevel?: string;
                completedLevels?: number;
                totalLevels?: number;
                batchesProcessed?: number;
            };
            totals?: {
                requested?: number;
                created?: number;
                skippedExisting?: number;
                reconciled?: number;
                failed?: number;
            };
            lastError?: string;
        }>('GET', `${baseUrl}/api/components/import/sigaa-public/jobs/${jobId}`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        console.log(JSON.stringify({
            ok: true,
            stage: 'job-progress',
            id: job.id,
            status: job.status,
            progress: job.progress || {},
            totals: job.totals || {},
            lastError: job.lastError || '',
        }, null, 2));

        if (job.status === 'completed') {
            return;
        }

        if (job.status === 'failed' || job.status === 'cancelled') {
            process.exitCode = 1;
            return;
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
