/* =========================================================
   auth.js — Supabase client + shared auth helpers
   Used by: login.html, signup.html, forgot-password.html,
            reset-password.html, app.html (guard)
========================================================= */

const SUPABASE_URL = "https://qgqtfqikamldvozvaprp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFncXRmcWlrYW1sZHZvenZhcHJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMTMyOTcsImV4cCI6MjA5Nzc4OTI5N30.hwlxoISJ7EdgSHgkP20jURUetTPqnjenE_VFxy6Z6OA";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---- Shared UI helpers ---- */
function setAuthError(el, msg) {
  el.textContent = msg;
  el.classList.add("visible");
}

function clearAuthError(el) {
  el.textContent = "";
  el.classList.remove("visible");
}

function setBtnLoading(btn, loading, loadingText, normalText) {
  btn.disabled = loading;
  btn.textContent = loading ? loadingText : normalText;
}

/* ---- Guard for app.html ---- */
async function requireAuth() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error || !data.session) {
    window.location.href = "login.html";
    return null;
  }
  return data.session;
}

/* ---- Theme init (shared across all auth pages) ---- */
(function initTheme() {
  const saved = localStorage.getItem("cc-theme");
  if (saved === "light") document.body.classList.add("light");
})();
