import { refreshAccessToken } from "@/lib/authRefresh";
import { END_POINT } from "@/lib/config";
import { ApiError } from "@/lib/fetch";
import useAuthStore from "@/stores/useAuthStore";

/** Backend streams the image bytes. Never follow a redirect to object storage. */
export async function getHazardPhoto(
  reportId: string,
  signal: AbortSignal,
): Promise<Blob> {
  if (!reportId || reportId === "." || reportId === "..")
    throw new Error("Invalid report ID");
  const account = useAuthStore.getState().user?._id;
  const session = useAuthStore.getState().session;
  const load = (token?: string) =>
    fetch(
      `${END_POINT}/api/v1/a11y/reports/${encodeURIComponent(reportId)}/photo`,
      {
        signal,
        credentials: "include",
        redirect: "error",
        cache: "no-store",
        headers: {
          Accept: "image/jpeg, image/png, image/webp",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    );
  let response = await load(session?.accessToken);
  if (
    response.status === 401 &&
    session?.accessToken &&
    !signal.aborted &&
    useAuthStore.getState().session === session
  ) {
    const token = await refreshAccessToken();
    signal.throwIfAborted();
    if (
      token &&
      useAuthStore.getState().user?._id === account &&
      useAuthStore.getState().session?.accessToken === token
    )
      response = await load(token);
  }
  signal.throwIfAborted();
  if (!response.ok)
    throw new ApiError("Report photo unavailable", response.status);
  const type = response.headers
    .get("Content-Type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (!type || !["image/jpeg", "image/png", "image/webp"].includes(type))
    throw new Error("Unsupported report photo response");
  const blob = await response.blob();
  signal.throwIfAborted();
  if (!blob.size) throw new Error("Empty report photo");
  return blob;
}
