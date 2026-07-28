import { getApiUser, jsonError } from "@/lib/auth";
import { adminRpc } from "@/lib/supabase";

const ALLOWED_ACTIONS: Record<string, number> = {
  solve: 1,
  debug: 1,
  followup: 1,
  resume_review: 2,
  resume_optimize: 3,
  interview_plan: 3,
};

export async function POST(request: Request) {
  const user = await getApiUser(request);
  if (!user) return jsonError("Authentication required.", 401);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";
  const cost = ALLOWED_ACTIONS[action];
  const requestId =
    typeof body.requestId === "string" && /^[A-Za-z0-9_-]{8,100}$/.test(body.requestId)
      ? body.requestId
      : "";
  if (!cost || !requestId) return jsonError("Invalid credit request.", 400);

  const result = await adminRpc<
    Array<{ success: boolean; balance: number; duplicate: boolean }>
  >("consume_credits", {
    p_user_id: user.id,
    p_cost: cost,
    p_action: action,
    p_reference: `usage:${user.id}:${requestId}`,
  });
  const outcome = result[0];
  if (!outcome?.success) {
    return jsonError("Not enough credits.", 402);
  }
  return Response.json({
    success: true,
    credits: outcome.balance,
    cost,
    duplicate: outcome.duplicate,
  });
}
