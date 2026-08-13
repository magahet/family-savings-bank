// App branding. Override per-instance via PUBLIC_* env vars in a local .env
// (see .env.example). Defaults keep the public template generic.
export const APP_NAME = import.meta.env.PUBLIC_APP_NAME ?? "Family Savings Bank";
export const APP_SHORT_NAME = import.meta.env.PUBLIC_APP_SHORT_NAME ?? "Savings Bank";
export const APP_TAGLINE = import.meta.env.PUBLIC_APP_TAGLINE ?? "Family Savings Tracker";
