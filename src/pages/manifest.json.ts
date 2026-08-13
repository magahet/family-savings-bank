import type { APIRoute } from "astro";
import { APP_NAME, APP_SHORT_NAME } from "../config";

// Generated at build time so the installed-app name follows the same branding
// config as the UI (PUBLIC_APP_NAME / PUBLIC_APP_SHORT_NAME in .env).
export const GET: APIRoute = () => {
  const manifest = {
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    start_url: "/",
    display: "standalone",
    background_color: "#030712",
    theme_color: "#059669",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: { "Content-Type": "application/manifest+json" },
  });
};
