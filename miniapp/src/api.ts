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
export async function get<T>(path: string): Promise<T> {
  if (import.meta.env.DEV && mock) return (await import("./mock.ts")).mockGet<T>(path);
  const response = await fetch(path, { headers: { authorization: `tma ${initData}` } });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}
