import type { PipeTransform } from "@nestjs/common";
import type { ZodTypeAny } from "zod";
import { AppException } from "../errors/app.exception";

/** Validate+parse a value against a Zod schema, e.g. @Body(new ZodValidationPipe(Schema)) */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException(400, "VALIDATION_ERROR", "Invalid request payload", {
        errors: result.error.flatten().fieldErrors,
      });
    }
    return result.data;
  }
}
