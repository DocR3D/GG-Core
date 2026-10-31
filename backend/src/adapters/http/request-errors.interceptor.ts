// src/adapters/http/request-errors.interceptor.ts
import { CallHandler, ExecutionContext, HttpException, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';

/**
 * Logs every refused request (4xx as a warning, 5xx as an error) with its method, address and reason, so a refusal
 * seen on the front ("refusé. …") can be found in `docker logs` afterwards (asked by the user: an error on a button
 * could not be diagnosed). The error itself goes on unchanged.
 */
@Injectable()
export class RequestErrorsInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<{ method: string; originalUrl?: string; url: string; ggSession?: { name?: string } | null }>();
    return next.handle().pipe(
      catchError((error: unknown) => {
        const status = error instanceof HttpException ? error.getStatus() : 500;
        const reason = error instanceof HttpException ? describe(error.getResponse()) : error instanceof Error ? error.message : String(error);
        const line = `${status} ${req.method} ${req.originalUrl ?? req.url} - ${reason}${req.ggSession?.name ? ` (${req.ggSession.name})` : ''}`;
        if (status >= 500) this.logger.error(line, error instanceof Error ? error.stack : undefined);
        else this.logger.warn(line);
        return throwError(() => error);
      }),
    );
  }
}

function describe(response: string | object): string {
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  return Array.isArray(message) ? message.join('; ') : String(message ?? JSON.stringify(response));
}
