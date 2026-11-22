import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

/**
 * Input that fails a zod schema is the client's error, not the server's:
 * answers 400 with the fields to fix instead of a generic 500.
 */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(error: ZodError, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw error;
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(400)
      .json({
        statusCode: 400,
        code: 'validation_error',
        message: 'Revisa los datos enviados.',
        issues: error.issues.slice(0, 20).map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
  }
}
