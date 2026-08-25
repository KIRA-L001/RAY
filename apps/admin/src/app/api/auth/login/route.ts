import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_TOKEN_COOKIE, apiLogin } from "@/lib/api";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");

  const token = await apiLogin(email, password);
  if (!token) {
    return NextResponse.redirect(new URL("/login?error=1", request.url), 303);
  }
  const res = NextResponse.redirect(new URL("/", request.url), 303);
  res.cookies.set(ADMIN_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 15 * 60,
  });
  return res;
}
