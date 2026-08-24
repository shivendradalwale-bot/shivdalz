import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
export const AUTH_TOKEN_KEY = "auth_token";

export async function getToken() {
  return storage.secureGet(AUTH_TOKEN_KEY, "");
}
export async function setToken(t: string) {
  return storage.secureSet(AUTH_TOKEN_KEY, t);
}
export async function clearToken() {
  return storage.secureRemove(AUTH_TOKEN_KEY);
}

type ReqOpts = {
  method?: string;
  body?: any;
  auth?: boolean;
  form?: FormData;
};

async function req(path: string, opts: ReqOpts = {}) {
  const { method = "GET", body, auth = true, form } = opts;
  const headers: Record<string, string> = {};
  if (!form) headers["Content-Type"] = "application/json";
  if (auth) {
    const t = await getToken();
    if (t) headers["Authorization"] = `Bearer ${t}`;
  }
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: form ? (form as any) : body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error((data && data.detail) || "Something went wrong. Please try again.");
  }
  return data;
}

export const api = {
  get: (p: string, auth = true) => req(p, { method: "GET", auth }),
  post: (p: string, body?: any, auth = true) => req(p, { method: "POST", body, auth }),
  put: (p: string, body?: any, auth = true) => req(p, { method: "PUT", body, auth }),
  del: (p: string, auth = true) => req(p, { method: "DELETE", auth }),
  postForm: (p: string, form: FormData, auth = true) => req(p, { method: "POST", form, auth }),
};
