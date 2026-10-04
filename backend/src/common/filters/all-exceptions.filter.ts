import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Formato de error uniforme. Los errores no controlados devuelven un mensaje
 * genérico (sin stack ni detalles internos) y el requestId para poder
 * encontrar la causa real en los logs.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { id?: string }>();
    const requestId = req.id;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (status >= 500) {
        this.logger.error(`[${requestId}] ${req.method} ${req.url} -> ${status}`);
      }
      res
        .status(status)
        .json(
          typeof body === 'string'
            ? { statusCode: status, message: body, requestId }
            : { ...(body as object), requestId },
        );
      return;
    }

    const err = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(`[${requestId}] ${req.method} ${req.url} -> 500: ${err.message}`, err.stack);
    res.status(500).json({
      statusCode: 500,
      message: 'Error interno del servidor',
      requestId,
    });
  }
}