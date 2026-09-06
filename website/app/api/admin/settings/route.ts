import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getAdminSettings, saveAdminSettings } from "@/lib/admin-data";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  return Response.json(await getAdminSettings());
}

export async function PUT(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  await saveAdminSettings(body);
  return Response.json({ success: true });
}
