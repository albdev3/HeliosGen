import { redirect } from "next/navigation";

// Keep any query string (e.g. the PKCE `?code=` from Supabase auth emails)
// when redirecting to the gallery, otherwise the code is lost and
// password-recovery / magic links silently do nothing.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  qs.set("tab", "images");
  for (const [k, v] of Object.entries(sp)) {
    if (k === "tab" || v === undefined) continue;
    for (const val of Array.isArray(v) ? v : [v]) qs.append(k, val);
  }
  redirect(`/gallery?${qs.toString()}`);
}
