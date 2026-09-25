import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
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

  it("refuses ids that are paths", async () => {
    const projects = await store();
    for (const id of ["..", "a/b", "..\\x", ""]) expect(() => projects.dir(id)).toThrow(/Invalid project id/);
    expect(() => projects.dir("missing")).toThrow(/No project/);
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
    expect(detail.videos[0].formats[0]).toMatchObject({ format: "portrait", duration: 48.2, video: join(dir, "portrait", "video.mp4") });
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
