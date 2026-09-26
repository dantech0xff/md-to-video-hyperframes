/**
 * What the Get Frames desktop app uses from the engine. Its engine host (an
 * Electron utility process) imports the built `dist/studio/engine.js` from the
 * engine folder, so the engine keeps finding its assets, runtime and pinned
 * dependencies where they are.
 */
export { startStudioHttp, type StudioHttp, type StudioHttpOptions } from "./http.js";
export { Gate, JobRunner, type Job, type JobStatus } from "./jobs.js";
export { Project } from "./project.js";
export { catalog, validateScript } from "./tools.js";
export { storyboardReview, type StoryboardReview, type StoryboardScene } from "./review.js";
export { runLessonPipeline, type LessonRunOptions, type LessonRunResult } from "../lesson/pipeline.js";
export { IMAGE_FIELDS, scriptInputsChangedAt } from "../lesson/inputs.js";
export type { LessonEvent, LessonWarningCode } from "../lesson/events.js";
export type { FormatName } from "../lesson/schema.js";
export { loadConfig, type Config } from "../config.js";
export { ffmpegBin, ffprobeBin, toolVersion } from "../utils/binaries.js";
export { hyperframesChromeBuild, installChrome, installedChrome } from "../utils/browser.js";
export { makeStarterSounds } from "../lesson/starter-sounds.js";
