import { Request, Response, NextFunction } from 'express';
import { ZodEffects, ZodTypeAny } from 'zod';
import { ApiError } from './errors';

type Schema = ZodTypeAny | ZodEffects<any>;

/** Validate and replace req.body with the parsed (safe) value. */
export function validateBody(schema: Schema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      next(
        new ApiError(
          400,
          'Validation failed',
          parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
        )
      );
      return;
    }
    req.body = parsed.data;
    next();
  };
}
