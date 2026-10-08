import { ImageResponse } from "next/og";
export const runtime = "edge";
export const alt = "Sidetone — your conversations, remembered.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function Image() {
  return new ImageResponse(<div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: "100%", height: "100%", padding: 80, background: "#0A192F", color: "#F6EFE2" }}><div style={{ fontSize: 82, fontWeight: 700 }}>sidetone</div><div style={{ fontSize: 40, marginTop: 32 }}>Your conversations, remembered.</div><div style={{ fontSize: 26, marginTop: 32 }}>Open source. Your infrastructure.</div></div>, size);
}
