import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Face check-in — Smart Workforce",
};

// Standalone surface: no sidebar, no portal navigation. The page handles its own (shared) kiosk sign-in.
export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return <div className="kiosk-screen">{children}</div>;
}
