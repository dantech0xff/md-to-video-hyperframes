import type { GetFramesApi } from "../../shared/api";

declare global {
  interface Window {
    getFrames: GetFramesApi;
  }
}
