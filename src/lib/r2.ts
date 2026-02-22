import { env } from "cloudflare:workers";

export async function uploadImage(
  file: File | ArrayBuffer,
  path: string,
): Promise<string> {
  const body = file instanceof File ? await file.arrayBuffer() : file;
  const contentType =
    file instanceof File ? file.type : "application/octet-stream";

  await env.IMAGES.put(path, body, {
    httpMetadata: { contentType },
  });

  return path;
}

export async function deleteImage(key: string): Promise<void> {
  await env.IMAGES.delete(key);
}

export { imageUrl } from "./image-url";

export async function getImage(
  key: string,
): Promise<{ body: ReadableStream; contentType: string } | null> {
  const obj = await env.IMAGES.get(key);
  if (!obj) return null;

  return {
    body: obj.body,
    contentType: obj.httpMetadata?.contentType ?? "application/octet-stream",
  };
}
