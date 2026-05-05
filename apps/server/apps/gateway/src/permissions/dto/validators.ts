import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  type ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'jsonMaxSize' })
export class JsonMaxSize implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (value == null) return true;
    const max: number = (args.constraints as number[] | undefined)?.[0] ?? 4096;
    try {
      return JSON.stringify(value).length <= max;
    } catch {
      return false;
    }
  }
  defaultMessage(args: ValidationArguments): string {
    const max: number = (args.constraints as number[] | undefined)?.[0] ?? 4096;
    return `JSON payload exceeds max size of ${max} bytes`;
  }
}
