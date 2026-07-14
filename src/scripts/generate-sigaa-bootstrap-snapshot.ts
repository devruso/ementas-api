import fs from 'fs';
import path from 'path';

import { AcademicLevel } from '../interfaces/AcademicLevel';
import { CrawlerService } from '../services/CrawlerService';

type SourceType = 'department' | 'program';

type SnapshotUnit = {
    sourceType: SourceType;
    sourceId: string;
    academicLevel: AcademicLevel;
    label: string;
    componentCount: number;
    components: Array<Record<string, unknown>>;
};

function getArgValue(flag: string): string | undefined {
    const match = process.argv.find((arg) => arg.startsWith(`${flag}=`));
    return match ? match.slice(flag.length + 1) : undefined;
}

function parseSourceIds(flag: string) {
    return String(getArgValue(flag) || '')
        .split(/[,\n;\r]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function parsePositiveInt(flag: string, fallback: number) {
    const parsed = Number(getArgValue(flag) || fallback);

    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }

    return Math.floor(parsed);
}

function parseBoolean(flag: string, fallback: boolean) {
    const rawValue = getArgValue(flag);

    if (!rawValue) {
        return fallback;
    }

    return /^(true|1|yes|on)$/i.test(rawValue);
}

function parseSourceType(flag: string, fallback: SourceType): SourceType {
    const rawValue = String(getArgValue(flag) || fallback).trim().toLowerCase();
    return rawValue === 'program' ? 'program' : 'department';
}

async function main() {
    const output = path.resolve(
        process.cwd(),
        getArgValue('--output') || 'bootstrap-data/sigaa-bootstrap.snapshot.json'
    );
    const enrichDetails = parseBoolean('--enrichDetails', true);
    const detailsConcurrency = parsePositiveInt('--detailsConcurrency', 4);
    const requestTimeoutMs = parsePositiveInt('--requestTimeoutMs', 120000);
    const configuredFamily = Number(getArgValue('--httpFamily') || process.env.CRAWLER_HTTP_FAMILY || 0);

    const requestedUnits = [
        ...parseSourceIds('--graduacaoSourceIds').map((sourceId) => ({
            sourceType: parseSourceType('--graduacaoSourceType', 'department'),
            sourceId,
            academicLevel: AcademicLevel.GRADUATION,
        })),
        ...parseSourceIds('--mestradoSourceIds').map((sourceId) => ({
            sourceType: parseSourceType('--mestradoSourceType', 'program'),
            sourceId,
            academicLevel: AcademicLevel.MASTERS,
        })),
        ...parseSourceIds('--doutoradoSourceIds').map((sourceId) => ({
            sourceType: parseSourceType('--doutoradoSourceType', 'program'),
            sourceId,
            academicLevel: AcademicLevel.DOCTORATE,
        })),
    ];

    if (requestedUnits.length === 0) {
        throw new Error('Informe pelo menos um sourceId em --graduacaoSourceIds, --mestradoSourceIds ou --doutoradoSourceIds.');
    }

    const service = Object.create(CrawlerService.prototype) as any;

    service.requestTimeoutMs = requestTimeoutMs;
    service.sigaaHttpFamily = configuredFamily === 4 || configuredFamily === 6
        ? configuredFamily
        : undefined;
    service.sigaaDetailCache = new Map();
    service.sigaaDetailInFlight = new Map();

    const collectSigaaComponents = (service as any).collectComponentsFromSigaaPublic.bind(service) as (
        sourceType: SourceType,
        sourceId: string,
        academicLevel: AcademicLevel,
        options?: { enrichDetails?: boolean; requestTimeoutMs?: number }
    ) => Promise<{
        componentsInfo: Array<Record<string, unknown>>;
        failed: number;
        failures: string[];
    }>;

    const units: SnapshotUnit[] = [];

    for (const requestedUnit of requestedUnits) {
        const collection = await collectSigaaComponents(
            requestedUnit.sourceType,
            requestedUnit.sourceId,
            requestedUnit.academicLevel,
            {
                enrichDetails,
                requestTimeoutMs,
            }
        );
        const components = collection.componentsInfo;

        units.push({
            ...requestedUnit,
            label: String(components[0]?.department || `${requestedUnit.sourceType}:${requestedUnit.sourceId}`),
            componentCount: components.length,
            components,
        });
    }

    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({
        generatedAt: new Date().toISOString(),
        requestTimeoutMs,
        enrichDetails,
        detailsConcurrency,
        units,
    }, null, 2));

    console.log(JSON.stringify({
        ok: true,
        output,
        units: units.map((unit) => ({
            sourceType: unit.sourceType,
            sourceId: unit.sourceId,
            academicLevel: unit.academicLevel,
            componentCount: unit.componentCount,
            label: unit.label,
        })),
    }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
