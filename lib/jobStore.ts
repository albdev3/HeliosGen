export type JobResult =
  | { status: "pending"; type?: "image" | "video"; userId?: string }
  | { status: "done"; imageUrl?: string; imageUrls?: string[]; videoUrl?: string }
  | { status: "error"; error: string };

// In-memory job cache.
//
// On serverless platforms (Vercel) the app directory is read-only and every
// request runs in an isolated instance, so a file-backed store both crashes
// (EROFS) and can't be shared between the generate / callback / job-status
// routes anyway. The source of truth is the Supabase `generations` table; the
// job-status and job-stream routes fall back to it via recoverJob(). This Map
// is only a hot-path cache within a single warm instance.
const store = new Map<string, JobResult>();

export const jobStore = {
  get(taskId: string): JobResult | undefined {
    return store.get(taskId);
  },
  set(taskId: string, result: JobResult): void {
    store.set(taskId, result);
  },
};
