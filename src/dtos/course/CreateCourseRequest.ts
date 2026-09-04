import { Transform } from 'class-transformer';
import { IsOptional } from 'class-validator';

import { CustomIsNotEmpty, CustomIsString, CustomMatches } from '../../decorators/validation';

export class CreateCourseRequestDto {
    @CustomIsNotEmpty()
    @CustomIsString()
    @Transform(({ value }) => String(value || '').replace(/\s+/g, ' ').trim())
    public name: string;

    @IsOptional()
    @CustomIsString()
    @Transform(({ value }) => {
        const normalized = String(value || '').replace(/\s+/g, '').trim().toUpperCase();
        return normalized || undefined;
    })
    @CustomMatches(/^[A-Z0-9_-]{2,20}$/)
    public code?: string;
}
