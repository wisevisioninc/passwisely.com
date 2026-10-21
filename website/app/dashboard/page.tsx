import type { Metadata } from "next";
import { PassWiselySite } from "../PassWiselySite";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

// The client requests the authenticated account/usage together. This public
// shell never embeds user data or rotates refresh credentials during SSR.
export default function DashboardPage() {
  return <PassWiselySite initialDashboard />;
}
