import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class LoginDto {
  // Retain the email field for API compatibility; it also accepts a register number.
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}

export class BootstrapAdminDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(1)
  name!: string;
}
