"use client";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkflowStore } from "@/lib/store";

// Mounted globally (via GlobalModals) so that a password-recovery link opens
// the "Set new password" modal on whatever page the user lands on.
export default function RecoveryListener() {
  const setResetPasswordModalOpen = useWorkflowStore((s) => s.setResetPasswordModalOpen);
  const setAuthModalOpen          = useWorkflowStore((s) => s.setAuthModalOpen);
  const setAuthModalView          = useWorkflowStore((s) => s.setAuthModalView);
  const addToast                  = useWorkflowStore((s) => s.addToast);

  useEffect(() => {
    const supabase = createClient();

    // Read the URL hash before Supabase consumes it.
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (params.get("type") === "recovery") {
      setResetPasswordModalOpen(true);
    } else if (params.get("error") || new URLSearchParams(window.location.search).get("error_code")) {
      // Expired / already-used link (error arrives in the hash for implicit
      // flow, in the query string for PKCE): back to "forgot password".
      const q = new URLSearchParams(window.location.search);
      ["error", "error_code", "error_description"].forEach((k) => q.delete(k));
      const qs = q.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
      addToast("Reset link expired or already used — please request a new one.", "info");
      setAuthModalView("forgot");
      setAuthModalOpen(true);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setResetPasswordModalOpen(true);
    });
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
