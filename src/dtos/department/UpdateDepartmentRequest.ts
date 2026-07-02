import { IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

import { CustomIsNotEmpty, CustomIsString, CustomMatches } from '../../decorators/validation';

export class UpdateDepartmentRequestDto {
    @CustomIsNotEmpty()
    @CustomIsString()
    @Transform(({ value }) => String(value || '').replace(/\s+/g, ' ').trim())
    public name: string;

    @IsOptional()
    @CustomIsString()
    @Transform(({ value }) => {
        const normalized = String(value || '').trim().toUpperCase();
        return normalized || undefined;
    })
    @CustomMatches(/^[A-Z0-9_-]{2,16}$/)
    public code?: string;
}