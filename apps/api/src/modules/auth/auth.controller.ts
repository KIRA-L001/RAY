import { Body, Controller, Get, HttpCode, Inject, Post, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { AuthService, REFRESH_COOKIE } from "../../common/auth/auth.service";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { JwtPayload } from "../../common/auth/jwt";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";

const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(1024),
});

const registerSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(1024),
});

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/v1/auth",
  maxAge: 30 * 24 * 60 * 60, // seconds; must match REFRESH_TTL_MS in auth.service
} as const;

@Controller("v1/auth")
export class AuthController {
  // tsx/esbuild does not emit design:paramtypes, so class-type injection needs an explicit token
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.login(body.email, body.password, reply.request.ip ?? "unknown");
    this.setRefreshCookie(reply, result.refreshToken);
    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.refresh(reply.request.cookies?.[REFRESH_COOKIE] ?? "");
    this.setRefreshCookie(reply, result.refreshToken);
    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.logout(reply.request.cookies?.[REFRESH_COOKIE]);
    reply.clearCookie(REFRESH_COOKIE, { path: cookieOptions.path });
    return { ok: true };
  }

  @Post("register")
  @HttpCode(201)
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: z.infer<typeof registerSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.register(body.email, body.password);
    this.setRefreshCookie(reply, result.refreshToken);
    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: JwtPayload) {
    return this.auth.me(user.sub);
  }

  private setRefreshCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(REFRESH_COOKIE, token, cookieOptions);
  }
}
