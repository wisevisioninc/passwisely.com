import { createAdminSession, verifyAdminCredentials } from "@/lib/admin-auth";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!verifyAdminCredentials(body.username, body.password)) {
    return Response.json({ error: "账号或密码错误。" }, { status: 401 });
  }
  await createAdminSession();
  return Response.json({ success: true });
}
