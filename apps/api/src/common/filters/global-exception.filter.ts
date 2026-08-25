import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import { ZodError } from "zod";
import { AppException } from "../errors/app.exception";

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse();

    if (exception instanceof AppException) {
      reply.status(exception.status).send({
        ok: false,
        error: { code: exception.code, message: exception.message },
      });
      return;
    }

    if (exception instanceof ZodError) {
      reply.status(HttpStatus.BAD_REQUEST).send({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request payload",
          // ponytail: flatten() keeps payloads small; switch to detailed issue list if clients need field-level errors
          details: exception.flatten().fieldErrors,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      reply.status(status).send({
        ok: false,
        error: { code: `HTTP_${status}`, message: exception.message },
      });
      return;
    }

    reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      ok: false,
      error: { code: "INTERNAL", message: "Internal server error" },
    });
  }
}
