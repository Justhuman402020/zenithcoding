// Keep generated output in its own namespace without changing source upsert keys.
const BUILD_PREFIX = ".code-haven-build/";

export function buildStoragePath(path: string): string {
  return BUILD_PREFIX + path.replace(/^(?:\.\/|\/)+/, "");
}

export function publishedFilePath(file: { path: string; kind?: string | null }): string {
  return file.kind === "build" && file.path.startsWith(BUILD_PREFIX)
    ? file.path.slice(BUILD_PREFIX.length)
    : file.path;
}