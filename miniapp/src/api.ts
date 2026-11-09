import { initData } from "./telegram.ts";

export class ApiError extends Error {
  status: number;
  constructor(status: number) {
    super(`API ${status}`);
    this.status = status;
  }
}

// `npm run miniapp:dev` with ?mock shows the screens on invented data, without Telegram. Dev builds only:
// the production build drops this branch and the mock with it.
export const mock = import.meta.env.DEV && new URLSearchParams(location.search).has("mock");

// Every request carries initData: the server checks it again each time.
async function request(path: string) {
  const response = await fetch(path, { headers: { authorization: `tma ${initData}` } });
  if (!response.ok) throw new ApiError(response.status);
  return response;
}

export async function get<T>(path: string): Promise<T> {
  if (import.meta.env.DEV && mock) return (await import("./mock.ts")).mockGet<T>(path);
  return (await request(path)).json() as Promise<T>;
}

// An <img> cannot send the header, so images are fetched with it and shown from a blob.
export async function getBlob(path: string): Promise<Blob> {
  if (import.meta.env.DEV && mock) throw new ApiError(404);
  return (await request(path)).blob();
}
