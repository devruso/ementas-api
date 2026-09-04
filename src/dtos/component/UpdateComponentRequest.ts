import { IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Component } from '../../entities/Component';
import { ComponentWorkloadDto } from './ComponentWorkload';
import { CustomIsString, CustomMatches } from '../../decorators/validation';
import { ComponentAcademicLevel } from '../../interfaces/AcademicLevel';

export class UpdateComponentRequestDto
implements Partial<Omit<Component, 'id' | 'userId' | 'status' | 'logs' | 'relations' | 'user' | 'workload' | 'generateLog' | 'createdAt' | 'updatedAt'>> {

    @IsOptional()
    @CustomIsString()
    @CustomMatches(/^[A-Z]{2,4}[0-9]{2,4}$/)
    public code?: string;

    @IsOptional()
    @CustomIsString()
    public name?: string;

    @IsOptional()
    @CustomIsString()
    public department?: string;

    @IsOptional()
    @CustomIsString()
    public courseId?: string;

    @IsOptional()
    @CustomIsString()
    public program?: string;

    @IsOptional()
    @CustomIsString()
    public semester?: string;

    @IsOptional()
    @CustomIsString()
    public prerequeriments?: string;

    @IsOptional()
    @CustomIsString()
    public methodology?: string;

    @IsOptional()
    @CustomIsString()
    public objective?: string;

    @IsOptional()
    @CustomIsString()
    public syllabus?: string;

    @IsOptional()
    @CustomIsString()
    public bibliography?: string;

    @IsOptional()
    @CustomIsString()
    public referencesBasic?: string;

    @IsOptional()
    @CustomIsString()
    public referencesComplementary?: string;

    @IsOptional()
    @CustomIsString()
    public modality?: string;

    @IsOptional()
    @CustomIsString()
    public learningAssessment?: string;

    @IsOptional()
    @CustomIsString()
    @CustomMatches(/^(graduacao|pos_graduacao|mestrado|doutorado)$/)
    public academicLevel?: ComponentAcademicLevel;
    
    public workloadId?: string;

    @IsOptional()
    @Type(() => ComponentWorkloadDto)
    @ValidateNested()
    public workload?: ComponentWorkloadDto;
}
