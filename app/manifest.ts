import type { MetadataRoute } from "next";

/** Makes ECO-SYSTEM installable: Add to Home Screen on iPhone, Install in Chrome or Safari on a laptop. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ECO-SYSTEM",
    short_name: "ECO-SYSTEM",
    description: "Your AI agents, working together.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#040907",
    theme_color: "#040907",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
