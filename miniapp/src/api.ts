import { initData } from "./telegram.ts";

export class ApiError extends Error {
  status: number;
  constructor(status: number) {
    super(`API ${status}`);
    this.status = status;
  }
}

// Every request carries initData: the server checks it again each time.
export async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { authorization: `tma ${initData}` } });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}
