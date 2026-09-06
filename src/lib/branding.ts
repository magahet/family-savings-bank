import { db } from "./firebase";
import { doc, getDoc } from "firebase/firestore";
import { APP_NAME, APP_TAGLINE } from "../config";

/**
 * Runtime branding. Admins can rename the app from Settings; the name/tagline
 * live in `settings/app`. We read them and update any element marked with
 * `data-app-name` / `data-app-tagline`, plus the document title. The build-time
 * config (PUBLIC_APP_* env, see src/config.ts) is the fallback if nothing's set.
 */
export async function loadBranding(): Promise<{ name: string; tagline: string }> {
  let name = APP_NAME;
  let tagline = APP_TAGLINE;
  try {
    const snap = await getDoc(doc(db, "settings", "app"));
    if (snap.exists()) {
      const d = snap.data();
      if (typeof d.name === "string" && d.name.trim()) name = d.name.trim();
      if (typeof d.tagline === "string" && d.tagline.trim()) tagline = d.tagline.trim();
    }
  } catch {
    // Unreadable (offline, etc.) — keep the build-time defaults.
  }
  return { name, tagline };
}

export function applyBranding(name: string, tagline: string): void {
  document.querySelectorAll<HTMLElement>("[data-app-name]").forEach((e) => (e.textContent = name));
  document.querySelectorAll<HTMLElement>("[data-app-tagline]").forEach((e) => (e.textContent = tagline));
  const titleEl = document.querySelector("title");
  const page = titleEl?.dataset.pageTitle;
  document.title = page ? `${page} | ${name}` : name;
}

export async function initBranding(): Promise<void> {
  const { name, tagline } = await loadBranding();
  applyBranding(name, tagline);
}
