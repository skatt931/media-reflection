import { initData } from "./telegram.ts";

export class ApiError extends Error {
  status: number;
  constructor(status: number) {
    super(`API ${status}`);
    this.status = status;
  }
}

// Every request carries initData: the server checks it again each time.
async function request(path: string, signal?: AbortSignal) {
  const response = await fetch(path, { headers: { authorization: `tma ${initData}` }, signal });
  if (!response.ok) throw new ApiError(response.status);
  return response;
}

export async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  return (await request(path, signal)).json() as Promise<T>;
}

// An <img> cannot send the header, so images are fetched with it and shown from a blob.
export async function getBlob(path: string): Promise<Blob> {
  return (await request(path)).blob();
}
