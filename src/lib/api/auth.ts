import { END_POINT } from "@/lib/config";
import { authenticatedRequest, fetchRequest } from "@/lib/fetch";
import type { ApiResponse } from "@/types/response";
import type { UserConfig, UserDTO } from "@/types/user";

type SessionResponse = ApiResponse<{ user: UserDTO; config: UserConfig }>;

export async function loginWithGoogle(idToken: string) {
  return fetchRequest(`${END_POINT}/api/v1/user/auth/google`, {
    method: "POST",
    body: { idToken },
  }) as Promise<SessionResponse>;
}

export async function registerWithEmail(
  name: string,
  email: string,
  password: string,
) {
  return fetchRequest(`${END_POINT}/api/v1/user/auth/register`, {
    method: "POST",
    body: { name, email, password },
  }) as Promise<ApiResponse<{ emailSent: boolean }>>;
}

export async function loginWithEmail(email: string, password: string) {
  return fetchRequest(`${END_POINT}/api/v1/user/auth/login`, {
    method: "POST",
    body: { email, password },
  }) as Promise<SessionResponse>;
}

export async function verifyEmail(token: string) {
  return fetchRequest(`${END_POINT}/api/v1/user/auth/verify-email`, {
    method: "POST",
    body: { token },
  }) as Promise<SessionResponse>;
}

export async function resendVerificationEmail(email: string) {
  return fetchRequest(`${END_POINT}/api/v1/user/auth/verify-email/resend`, {
    method: "POST",
    body: { email },
  }) as Promise<ApiResponse<null>>;
}

export async function forgotPassword(email: string) {
  return fetchRequest(`${END_POINT}/api/v1/user/auth/password/forgot`, {
    method: "POST",
    body: { email },
  }) as Promise<ApiResponse<null>>;
}

export async function resetPassword(token: string, password: string) {
  return fetchRequest(`${END_POINT}/api/v1/user/auth/password/reset`, {
    method: "POST",
    body: { token, password },
  }) as Promise<SessionResponse>;
}

export async function changePassword(
  newPassword: string,
  currentPassword?: string,
) {
  return authenticatedRequest(`${END_POINT}/api/v1/user/auth/password`, {
    method: "POST",
    body: currentPassword ? { currentPassword, newPassword } : { newPassword },
    // 401 here means "current password wrong" (a business error, not an
    // expired token) — don't let it trigger refresh-retry-then-logout.
    skipAuthRetry: true,
  }) as Promise<ApiResponse<{ user: UserDTO }>>;
}

export async function refreshToken(): Promise<string | null> {
  try {
    const response = await fetchRequest(`${END_POINT}/api/v1/user/refresh`, {
      method: "POST",
    });
    if (!response.ok) {
      return null;
    }
    // SAFETY: response payload contains accessToken on refresh success
    return (
      ((response as unknown as Record<string, unknown>)
        .accessToken as string) || null
    );
  } catch {
    return null;
  }
}

export async function logout(): Promise<ApiResponse<null>> {
  return fetchRequest(`${END_POINT}/api/v1/user/logout`, {
    method: "POST",
  }) as Promise<ApiResponse<null>>;
}
