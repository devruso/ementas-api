import { CustomIsEmail, CustomIsNotEmpty } from '../../decorators/validation';

export class ResetPasswordRequestDto {
    @CustomIsNotEmpty()
    @CustomIsEmail()
    public email: string;
}