import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Readable } from "node:stream";
import { map, Observable } from "rxjs";

/** Wraps every successful response in the shared ApiResult envelope: {ok:true,data}. */
@Injectable()
export class ApiEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        // Streaming responses (Readable) and already-sent/hijacked replies must not be wrapped.
        if (data instanceof Readable || (data && typeof (data as { pipe?: unknown }).pipe === "function")) {
          return data;
        }
        // Passthrough streaming controllers return void after reply.send(stream).
        if (data === undefined || data === null) return data;
        const res = context.switchToHttp().getResponse() as { sent?: boolean; hijacked?: boolean };
        if (res?.sent || res?.hijacked) return data;
        return { ok: true, data };
      }),
    );
  }
}
