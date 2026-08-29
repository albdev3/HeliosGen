import { NextRequest, NextResponse } from "next/server";
import { jobStore } from "@/lib/jobStore";
import { jobEvents } from "@/lib/jobEvents";
import { mirrorToR2 } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GUEST_MODE } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";

// Mirroring a video to R2 can take a while; keep the function alive for it.
export const maxDuration = 300;

function extractUrls(resultJson?: string): string[] {
  if (!resultJson) return [];
  try {
    const parsed = JSON.parse(resultJson);
    const urls = parsed.resultUrls ?? parsed.resultUrl;
    if (Array.isArray(urls)) return urls.filter(Boolean);
    if (urls) return [urls];
    return [];
  } catch {
    return [];
  }
}

function settle(taskId: string, result: Parameters<typeof jobStore.set>[1]) {
  jobStore.set(taskId, result);
  jobEvents.emit(`job:${taskId}`, result);
}

async function markError(taskId: string, error: string) {
  settle(taskId, { status: "error", error });
  if (GUEST_MODE) {
    guestDb.updateGeneration(taskId, { status: "error", error_msg: error });
    return;
  }
  const { error: e } = await supabaseAdmin
    .from("generations")
    .update({ status: "error", error_msg: error })
    .eq("task_id", taskId);
  if (e) console.error("[callback] supabase error update failed:", e.message);
}

async function getGenerationType(taskId: string): Promise<"image" | "video" | null> {
  if (GUEST_MODE) return null;
  const { data } = await supabaseAdmin
    .from("generations")
    .select("generation_type")
    .eq("task_id", taskId)
    .single();
  return (data?.generation_type as "image" | "video" | undefined) ?? null;
}

// IMPORTANT: on serverless the function is frozen as soon as it returns a
// response, so every async side-effect here must be awaited before returning —
// no fire-and-forget .then() chains.
export async function POST(req: NextRequest) {
  const body = await req.json();
  console.log("[callback] received:", JSON.stringify(body, null, 2));

  const data   = body.data ?? body;
  const taskId = data.taskId ?? data.id ?? body.taskId ?? body.id;
  const state  = String(data.state ?? data.status ?? "").toLowerCase();

  console.log("[callback] taskId:", taskId, "state:", state);

  if (!taskId) {
    console.log("[callback] could not extract taskId");
    return NextResponse.json({ received: true });
  }

  // Non-200 top-level code = hard error (e.g. Veo 500 responses with no state).
  if (body.code !== undefined && body.code !== 200) {
    const error = data.failMsg ?? body.msg ?? "Generation failed";
    console.log("[callback] top-level error code:", body.code, error);
    await markError(taskId, error);
    return NextResponse.json({ received: true });
  }

  if (state === "success") {
    let kieUrls = extractUrls(data.resultJson);
    if (kieUrls.length === 0 && data.videoUrl) {
      kieUrls = [data.videoUrl];
    }
    if (kieUrls.length === 0 && (data.output?.[0] ?? data.output)) {
      kieUrls.push(data.output?.[0] ?? data.output);
    }

    if (kieUrls.length === 0) {
      console.log("[callback] success but no URL found in resultJson");
      return NextResponse.json({ received: true });
    }

    // The in-memory jobStore is not shared across serverless instances, so tell
    // image from video via the persisted row (jobStore is the guest-mode path).
    const genType  = await getGenerationType(taskId);
    const existing = jobStore.get(taskId);
    const isVideo  = genType
      ? genType === "video"
      : existing?.status === "pending" && (existing as { type?: string }).type === "video";
    const folder   = isVideo ? "videos" : "images";

    // Try to mirror to R2; fall back to the source URLs if that fails.
    let storedUrls = kieUrls;
    try {
      storedUrls = await Promise.all(kieUrls.map((u) => mirrorToR2(u, folder)));
    } catch (err) {
      console.error("[callback] storage upload failed, using source URLs:", (err as Error).message);
    }

    if (isVideo) {
      settle(taskId, { status: "done", videoUrl: storedUrls[0] });
      if (GUEST_MODE) {
        guestDb.updateGeneration(taskId, { status: "done", video_url: storedUrls[0] });
      } else {
        const { error: e } = await supabaseAdmin
          .from("generations")
          .update({ status: "done", video_url: storedUrls[0] })
          .eq("task_id", taskId);
        if (e) console.error("[callback] supabase update error:", e.message);
      }
    } else {
      settle(taskId, { status: "done", imageUrl: storedUrls[0], imageUrls: storedUrls });
      if (GUEST_MODE) {
        guestDb.updateGeneration(taskId, { status: "done", image_url: storedUrls[0], image_urls: storedUrls });
      } else {
        const { error: e } = await supabaseAdmin
          .from("generations")
          .update({ status: "done", image_url: storedUrls[0], image_urls: storedUrls })
          .eq("task_id", taskId);
        if (e) console.error("[callback] supabase update error:", e.message);
      }
    }
  } else if (state === "fail" || state === "failed" || state === "error") {
    const error = data.failMsg ?? data.error ?? body.msg ?? "Generation failed";
    await markError(taskId, error);
  } else {
    console.log("[callback] intermediate state, ignoring:", state);
  }

  return NextResponse.json({ received: true });
}
