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
  try {
    await saveAdminSettings(body);
    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not save settings." },
      { status: 400 },
    );
  }
}
