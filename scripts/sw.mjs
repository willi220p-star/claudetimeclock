// Builds out/sw.js for the GitHub Pages export (D34): the template plus the list of files to save on the
// phone and a version from their contents. Runs after `next build`; does nothing without an export.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const OUT = "out";
const BASE = "/claudetimeclock/";
// Saved: pages, their data, scripts, styles, fonts and icons. Skipped: source maps and big media.
const KEEP = /\.(html|txt|js|css|woff2?|png|svg|ico|webmanifest|json)$/;
const MAX_BYTES = 2_000_000;

if (process.env.GITHUB_PAGES !== "true" || !existsSync(OUT)) {
  console.log("sw: not the Pages export, skipping");
  process.exit(0);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(OUT)
  .map((path) => relative(OUT, path).split(sep).join("/"))
  .filter((path) => path !== "sw.js" && KEEP.test(path) && statSync(join(OUT, path)).size <= MAX_BYTES)
  .sort();

const hash = createHash("sha256");
for (const file of files) hash.update(file).update(readFileSync(join(OUT, file)));
const version = hash.digest("hex").slice(0, 12);

// Pages are requested as folders (trailingSlash), so save index.html under the folder URL.
const urls = files.map((file) => BASE + (file === "index.html" ? "" : file.replace(/(^|\/)index\.html$/, "$1")));

const template = readFileSync(new URL("./sw-template.js", import.meta.url), "utf8");
writeFileSync(
  join(OUT, "sw.js"),
  template.replace("__VERSION__", version).replace("__BASE__", BASE).replace("__PRECACHE__", JSON.stringify(urls)),
);
console.log(`sw: ${urls.length} files, version ${version}`);
