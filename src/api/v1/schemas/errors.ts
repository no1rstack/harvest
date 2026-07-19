/** Error envelopes — aligned with World Monitor API reference shapes. */

export interface FieldViolation {
  field: string;
  description: string;
}

export interface ValidationError {
  violations: FieldViolation[];
}

export interface ApiError {
  error: string;
  message?: string;
}

export function validationError(violations: FieldViolation[]): ValidationError {
  return { violations };
}
