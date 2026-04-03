import { nanoid } from "nanoid";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function generateSlug(title: string): string {
  return `${slugify(title)}-${nanoid(6)}`;
}
