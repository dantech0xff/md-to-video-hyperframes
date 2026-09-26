/**
 * The material of a new video: what counts as a picture, and what a news
 * brief needs, words the agent can take its facts from (a link, a document,
 * pasted text). Pictures only go with them.
 */
import { IMAGE_EXTENSIONS, type NewProjectRequest } from "./types";

/** A picture, by its file name (.jpg, .png, .webp). */
export function isImage(file: string): boolean {
  const ext = /\.([^./\\]+)$/.exec(file)?.[1]?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.includes(ext);
}

/** Some material with words in it: a link, pasted text or a file that is not a picture. */
export function hasTextMaterial(req: Pick<NewProjectRequest, "files" | "urls" | "text">): boolean {
  return req.urls.some((u) => u.trim()) || !!req.text.trim() || req.files.some((f) => !isImage(f));
}
