import { Type } from 'class-transformer';
import { IsOptional } from 'class-validator';
import { CustomIsNotEmpty, CustomIsNumber, CustomIsString, CustomMin } from '../../../decorators/validation';
import { CustomIsDateString } from '../../../decorators/validation/CustomIsDateString';

export class ApproveDraftRequestDto {
    @CustomIsNotEmpty()
    @CustomIsString()
    public password: string;

    @IsOptional()
    @CustomIsNotEmpty()
    @CustomIsDateString()
    public agreementDate?: string;

    @IsOptional()
    @Type(() => Number)
    @CustomIsNumber({ maxDecimalPlaces: 0 })
    @CustomMin(1)
    public agreementNumber?: number;
}
