import { describe, it, expect } from "vitest";
import { existsSync, statSync, symlinkSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NewProjectRequest } from "../shared/types";
import { freeName, ProjectStore, slugify } from "./projects";

const request = (over: Partial<NewProjectRequest> = {}): NewProjectRequest => ({
  title: "Kotlin Flow cơ bản",
  kind: "lesson",
  notes: "",
  style: "",
  voice: "free",
  files: [],
  urls: [],
  text: "",
  ...over,
});

async function store(now = new Date("2026-09-25T08:00:00Z")) {
  const root = await mkdtemp(join(tmpdir(), "projects-"));
  const skills = join(root, "_skills");
  await mkdir(join(skills, "create-lesson-video", "reference"), { recursive: true });
  await writeFile(join(skills, "create-lesson-video", "SKILL.md"), "# skill\n");
  await writeFile(join(skills, "create-lesson-video", "reference", "example-lesson.json"), "{}");
  return new ProjectStore({ root: () => join(root, "projects"), skillsDir: skills, now: () => now });
}

describe("slugify", () => {
  it("makes ASCII folder names from Vietnamese titles", () => {
    expect(slugify("Kotlin Flow cơ bản")).toBe("kotlin-flow-co-ban");
    expect(slugify("Đồng bộ dữ liệu: Room + Flow!")).toBe("dong-bo-du-lieu-room-flow");
    expect(slugify("   ")).toBe("video");
    expect(slugify("a".repeat(80)).length).toBe(48);
  });
});

describe("ProjectStore", () => {
  it("creates a dated folder with project.json, sources and the agent files", async () => {
    const projects = await store();
    const id = await projects.create(request({ notes: "Cho người mới" }), async (dir) => {
      await writeFile(join(dir, "sources", "notes.md"), "Flow là gì");
      return [{ file: "sources/notes.md", origin: "text" }];
    });
    expect(id).toBe("2026-09-25-kotlin-flow-co-ban");
    const dir = projects.dir(id);
    const project = await projects.read(id);
    expect(project).toMatchObject({
      version: 1,
      title: "Kotlin Flow cơ bản",
      kind: "lesson",
      request: { topic: "Kotlin Flow cơ bản", notes: "Cho người mới", style: "", voice: "free" },
      sources: [{ file: "sources/notes.md", origin: "text" }],
      agent: { id: "claude-code" },
    });
    expect(await readFile(join(dir, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    const agents = await readFile(join(dir, "AGENTS.md"), "utf8");
    expect(agents).toContain("`script.json`: bài giảng YouTube 16:9");
    expect(agents).toContain("`short/script.json`: Short 9:16");
    for (const skills of [".agents", ".claude"]) {
      expect(existsSync(join(dir, skills, "skills", "create-lesson-video", "reference", "example-lesson.json"))).toBe(true);
    }
    expect(await projects.summary(id, "idle")).toMatchObject({ agent: "claude-code" });
  });

  it("makes a news brief from the user's material only", async () => {
    const projects = await store();
    // a brief without material would be written from memory
    await expect(projects.create(request({ kind: "news", title: "Android 17 beta" }), async () => [])).rejects.toThrow(/Bản tin cần ít nhất một nguồn/);
    const id = await projects.create(request({ kind: "news", title: "Android 17 beta", urls: ["https://android-developers.googleblog.com/x"] }), async () => []);
    expect((await projects.read(id)).kind).toBe("news");
    expect(await readFile(join(projects.dir(id), "AGENTS.md"), "utf8")).toContain("`script.json`: bản tin 9:16 theo mục \"News\"");
    expect((await projects.detail(id, "idle", async () => ({ ok: false, errors: [], formats: [] }))).videos).toMatchObject([
      { id: "main", label: "Bản tin 9:16", script: "script.json", formats: [{ format: "portrait" }] },
    ]);
    await expect(projects.create(request({ kind: "tiktok" as never }), async () => [])).rejects.toThrow(/Không có loại video "tiktok"/);
  });

  it("keeps the agent picked for the video, one the app drives", async () => {
    const projects = await store();
    const id = await projects.create(request({ agent: "devin" }), async () => []);
    expect((await projects.read(id)).agent).toEqual({ id: "devin" });
    expect(await projects.summary(id, "idle")).toMatchObject({ agent: "devin" });
    await expect(projects.create(request({ title: "Khác", agent: "cursor" as never }), async () => [])).rejects.toThrow(/Không có agent "cursor"/);
    expect((await projects.list()).map((p) => p.id)).toEqual([id]);
  });

  it("never reuses a folder, and leaves nothing behind when sources fail", async () => {
    const projects = await store();
    const a = await projects.create(request(), async () => []);
    const b = await projects.create(request(), async () => []);
    expect([a, b]).toEqual(["2026-09-25-kotlin-flow-co-ban", "2026-09-25-kotlin-flow-co-ban-2"]);
    await expect(
      projects.create(request({ title: "Hỏng" }), async () => {
        throw new Error("Không tải được https://example.com");
      }),
    ).rejects.toThrow("Không tải được");
    expect((await readdir(projects.root)).sort()).toEqual([a, b]);
    await expect(projects.create(request({ title: "  " }), async () => [])).rejects.toThrow(/tên hoặc chủ đề/);
  });

  it("gives creations of one title at the same time their own folders", async () => {
    const projects = await store();
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    // the first is still importing its sources when the second finishes
    const first = projects.create(request(), async (dir) => {
      await writeFile(join(dir, "sources", "a.md"), "A");
      await slow;
      return [{ file: "sources/a.md", origin: "text" }];
    });
    const second = projects.create(request(), async (dir) => {
      await writeFile(join(dir, "sources", "b.md"), "B");
      return [{ file: "sources/b.md", origin: "text" }];
    });
    const b = await second;
    release();
    const a = await first;
    expect(new Set([a, b]).size).toBe(2);
    expect((await projects.read(a)).sources).toEqual([{ file: "sources/a.md", origin: "text" }]);
    expect(await readdir(join(projects.dir(a), "sources"))).toEqual(["a.md"]);
    expect(await readdir(join(projects.dir(b), "sources"))).toEqual(["b.md"]);
  });

  it("leaves nothing behind when the agent files cannot be written", async () => {
    const root = await mkdtemp(join(tmpdir(), "projects-"));
    const projects = new ProjectStore({ root: () => join(root, "projects"), skillsDir: join(root, "no-skills-here"), now: () => new Date("2026-09-25T08:00:00Z") });
    await expect(projects.create(request(), async () => [])).rejects.toThrow();
    expect(await readdir(projects.root)).toEqual([]);
    expect(await projects.list()).toEqual([]);
  });

  it("refuses ids that are paths", async () => {
    const projects = await store();
    for (const id of ["..", "a/b", "..\\x", ""]) expect(() => projects.dir(id)).toThrow(/Invalid project id/);
    expect(() => projects.dir("missing")).toThrow(/No project/);
  });

  it.skipIf(process.platform === "win32")("takes no link to a folder elsewhere for a project", async () => {
    const projects = await store();
    const id = await projects.create(request(), async () => []);
    // a folder outside the projects folder that looks like a project
    const elsewhere = await mkdtemp(join(tmpdir(), "elsewhere-"));
    await writeFile(join(elsewhere, "project.json"), await readFile(join(projects.dir(id), "project.json")));
    symlinkSync(elsewhere, join(projects.root, "linked"));
    expect(() => projects.dir("linked")).toThrow(/No project/);
    expect((await projects.list()).map((p) => p.id)).toEqual([id]);
  });

  it("tells the stage of a project from its files", async () => {
    const projects = await store();
    const id = await projects.create(request({ kind: "short", title: "Launch hay async" }), async () => []);
    const dir = projects.dir(id);
    const stage = async () => (await projects.summary(id, "idle")).stage;
    expect(await stage()).toBe("new");

    await writeFile(join(dir, "script.json"), JSON.stringify({ formats: ["portrait"] }));
    expect(await stage()).toBe("writing");

    await mkdir(join(dir, "portrait", "storyboard"), { recursive: true });
    await writeFile(join(dir, "portrait", "storyboard.jpg"), "");
    await writeFile(join(dir, "portrait", "storyboard", "shot-001.png"), "");
    await writeFile(join(dir, "portrait", "plan.json"), JSON.stringify({ duration: 48.2 }));
    const summary = await projects.summary(id, "working");
    expect(summary).toMatchObject({ stage: "review", agentState: "working", thumbnail: join(dir, "portrait", "storyboard", "shot-001.png") });

    await writeFile(join(dir, "portrait", "video.mp4"), "");
    expect(await stage()).toBe("rendered");

    const detail = await projects.detail(id, "idle", async () => ({ ok: true, errors: [], formats: ["portrait"] }));
    expect(detail.videos).toHaveLength(1);
    expect(detail.videos[0]).toMatchObject({ id: "main", label: "Short 9:16", exists: true, valid: true, youtubeExists: false });
    expect(detail.videos[0].formats[0]).toMatchObject({ format: "portrait", duration: 48.2, video: join(dir, "portrait", "video.mp4"), videoStale: false });

    // the agent changed the script after the render: the video is out of date
    const later = new Date(Date.now() + 60_000);
    await utimes(join(dir, "script.json"), later, later);
    expect(await stage()).toBe("review");
    const stale = await projects.detail(id, "idle", async () => ({ ok: true, errors: [], formats: ["portrait"] }));
    expect(stale.videos[0].formats[0]).toMatchObject({ video: join(dir, "portrait", "video.mp4"), videoStale: true });
  });

  it("calls a video out of date when an image its script shows changed after the render, in the list too", async () => {
    const projects = await store();
    const id = await projects.create(request({ kind: "short", title: "Pin mới" }), async () => []);
    const dir = projects.dir(id);
    const scenes = [{ id: "photo", type: "image", voice: "Ảnh.", src: "sources/photo.jpg" }];
    await writeFile(join(dir, "script.json"), JSON.stringify({ formats: ["portrait"], chapters: [{ title: "Tin", scenes }] }));
    await mkdir(join(dir, "sources"), { recursive: true });
    await writeFile(join(dir, "sources", "photo.jpg"), "photo");
    await mkdir(join(dir, "portrait"), { recursive: true });
    await writeFile(join(dir, "portrait", "storyboard.jpg"), "");
    await writeFile(join(dir, "portrait", "video.mp4"), "");
    const check = async () => ({ ok: true, errors: [], formats: ["portrait" as const] });
    // rendered after the script and the photo were written
    const later = new Date(Math.ceil(Date.now() / 1000) * 1000 + 60_000);
    await utimes(join(dir, "portrait", "video.mp4"), later, later);
    expect((await projects.summary(id, "idle")).stage).toBe("rendered");
    expect((await projects.detail(id, "idle", check)).videos[0].formats[0].videoStale).toBe(false);

    // the photo is replaced after the render, the script is not touched: the list, the project screen and the project's time all see it
    const past = new Date(Date.now() - 60_000);
    await utimes(join(dir, "portrait", "video.mp4"), past, past);
    await utimes(join(dir, "script.json"), past, past);
    await writeFile(join(dir, "sources", "photo.jpg"), "another photo");
    await utimes(join(dir, "sources", "photo.jpg"), past, past);
    const photo = statSync(join(dir, "sources", "photo.jpg"));
    const summary = await projects.summary(id, "idle");
    expect(summary.stage).toBe("review");
    expect(Date.parse(summary.updatedAt)).toBeGreaterThanOrEqual(Math.floor(photo.ctimeMs));
    const detail = await projects.detail(id, "idle", check);
    expect(detail.stage).toBe("review");
    expect(detail.videos[0].formats[0].videoStale).toBe(true);

    // a missing photo: nothing made from the script is current, and the project still has a time
    await rm(join(dir, "sources", "photo.jpg"));
    const missing = await projects.summary(id, "idle");
    expect(missing.stage).toBe("review");
    expect(Number.isNaN(Date.parse(missing.updatedAt))).toBe(false);
  });

  it("calls a lesson rendered only when its Short is rendered too", async () => {
    const projects = await store();
    const id = await projects.create(request(), async () => []);
    const dir = projects.dir(id);
    const stage = async () => (await projects.summary(id, "idle")).stage;
    const render = async (script: string, format: string) => {
      const base = join(dir, script, "..");
      await mkdir(join(base, format), { recursive: true });
      await writeFile(join(dir, script), JSON.stringify({ formats: [format] }));
      await writeFile(join(base, format, "storyboard.jpg"), "");
      await writeFile(join(base, format, "video.mp4"), "");
    };
    await render("script.json", "landscape");
    expect(await stage()).toBe("review");
    await render("short/script.json", "portrait");
    expect(await stage()).toBe("rendered");
  });

  it("dates a project by its newest file, the publish kit included", async () => {
    const projects = await store();
    const id = await projects.create(request({ kind: "short" }), async () => []);
    const dir = projects.dir(id);
    await writeFile(join(dir, "script.json"), JSON.stringify({ formats: ["portrait"] }));
    await writeFile(join(dir, "youtube.md"), "# Tiêu đề");
    // a whole second, a day from now: later than every other file
    const edited = new Date(Math.ceil(Date.now() / 1000) * 1000 + 86_400_000);
    await utimes(join(dir, "youtube.md"), edited, edited);
    expect((await projects.summary(id, "idle")).updatedAt).toBe(edited.toISOString());
  });

  it("lists projects, newest first", async () => {
    const projects = await store();
    const a = await projects.create(request({ title: "Một" }), async () => []);
    const b = await projects.create(request({ title: "Hai" }), async () => []);
    await projects.update(a, (p) => (p.request.notes = "sửa"));
    // update() stamps the store's fixed clock; make b older
    await projects.update(b, () => undefined);
    const list = await projects.list();
    expect(list.map((p) => p.id).sort()).toEqual([a, b].sort());
    expect(list[0].updatedAt >= list[1].updatedAt).toBe(true);
  });
});

describe("freeName", () => {
  it("adds a number until the name is free", async () => {
    const dir = await mkdtemp(join(tmpdir(), "names-"));
    expect(freeName(dir, "notes.md")).toBe("notes.md");
    await writeFile(join(dir, "notes.md"), "");
    await writeFile(join(dir, "notes-2.md"), "");
    expect(freeName(dir, "notes.md")).toBe("notes-3.md");
  });
});
