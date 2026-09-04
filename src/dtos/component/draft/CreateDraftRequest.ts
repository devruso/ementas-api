import { Type } from 'class-transformer';
import { IsDefined, IsOptional, ValidateNested } from 'class-validator';
import { CustomIsString, CustomMatches } from '../../../decorators/validation';
import { ComponentWorkloadDto } from '../ComponentWorkload';
import { CreateComponentRequestDto } from '../CreateComponentRequest';

export class CreateDraftRequestDto extends CreateComponentRequestDto {
    @IsDefined()
    @CustomIsString()
    @CustomMatches(/^[A-Z]{2,4}[0-9]{2,4}$/)
    declare public code: string;

    @IsOptional()
    @CustomIsString()
    declare public name: string;

    @IsOptional()
    @CustomIsString()
    declare public department: string;

    @IsOptional()
    @CustomIsString()
    declare public courseId?: string;

    @IsOptional()
    @CustomIsString()
    declare public program: string;

    @IsOptional()
    @CustomIsString()
    declare public semester: string;

    @IsOptional()
    @CustomIsString()
    declare public prerequeriments: string;

    @IsOptional()
    @CustomIsString()
    declare public methodology: string;

    @IsOptional()
    @CustomIsString()
    declare public objective: string;

    @IsOptional()
    @CustomIsString()
    declare public syllabus: string;

    @IsOptional()
    @CustomIsString()
    declare public bibliography: string;

    @IsOptional()
    @CustomIsString()
    declare public referencesBasic: string;

    @IsOptional()
    @CustomIsString()
    declare public referencesComplementary: string;
    
    @IsOptional()
    @CustomIsString()
    declare public modality: string;

    @IsOptional()
    @CustomIsString()
    declare public learningAssessment: string;

    @IsOptional()
    @Type(() => ComponentWorkloadDto)
    @ValidateNested()
    declare public workload?: ComponentWorkloadDto;
}
