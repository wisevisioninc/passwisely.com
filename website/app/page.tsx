import type { Metadata } from "next";
import { PassWiselySite } from "./PassWiselySite";

export const metadata: Metadata = {
  title: "PassWisely — AI Interview Copilot",
  description:
    "Capture interview questions, reason clearly, and prepare stronger answers with a private cross-platform AI desktop copilot.",
};

export default function Home() {
  return <PassWiselySite />;
}
