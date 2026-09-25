import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { ffmpegBin, ffprobeBin, hyperframesCli, hyperframesEnv, prependPath } from "./binaries.js";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("binaries", () => {
  it("uses ffmpeg/ffprobe from PATH unless a path is given", () => {
    delete process.env.FFMPEG_PATH;
    delete process.env.FFPROBE_PATH;
    expect(ffmpegBin()).toBe("ffmpeg");
    expect(ffprobeBin()).toBe("ffprobe");
    process.env.FFMPEG_PATH = "/opt/getframes/bin/ffmpeg";
    process.env.FFPROBE_PATH = "/opt/getframes/bin/ffprobe";
    expect(ffmpegBin()).toBe("/opt/getframes/bin/ffmpeg");
    expect(ffprobeBin()).toBe("/opt/getframes/bin/ffprobe");
  });

  it("resolves the locked HyperFrames CLI entry script", () => {
    delete process.env.HYPERFRAMES_CLI;
    const cli = hyperframesCli();
    expect(existsSync(cli)).toBe(true);
    expect(cli).toMatch(/hyperframes[\\/]dist[\\/]cli\.js$/);
    process.env.HYPERFRAMES_CLI = "/tmp/fake-cli.js";
    expect(hyperframesCli()).toBe("/tmp/fake-cli.js");
  });

  it("turns off telemetry, update checks and self-install for HyperFrames", () => {
    const env = hyperframesEnv({ PATH: "/usr/bin" });
    expect(env.HYPERFRAMES_NO_TELEMETRY).toBe("1");
    expect(env.HYPERFRAMES_NO_UPDATE_CHECK).toBe("1");
    expect(env.HYPERFRAMES_NO_AUTO_INSTALL).toBe("1");
    expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(env.PATH).toBe("/usr/bin");
  });

  it("puts the given FFmpeg first on PATH so HyperFrames finds it", () => {
    const ffmpeg = join("/opt", "getframes", "bin", "ffmpeg");
    const env = hyperframesEnv({ PATH: "/usr/bin", FFMPEG_PATH: ffmpeg, FFPROBE_PATH: join("/opt", "getframes", "bin", "ffprobe") });
    expect(env.PATH).toBe([dirname(ffmpeg), "/usr/bin"].join(delimiter));
  });

  it("keeps the case of an existing Path key (Windows)", () => {
    const env = prependPath({ Path: "C:\\Windows" }, ["C:\\getframes\\bin"]);
    expect(env.Path).toBe(["C:\\getframes\\bin", "C:\\Windows"].join(delimiter));
    expect(env.PATH).toBeUndefined();
  });
});
