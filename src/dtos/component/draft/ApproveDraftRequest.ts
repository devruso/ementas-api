import { CustomIsNotEmpty, CustomIsString } from '../../../decorators/validation';

export class ApproveDraftRequestDto {
    @CustomIsNotEmpty()
    @CustomIsString()
    public password: string;
}
