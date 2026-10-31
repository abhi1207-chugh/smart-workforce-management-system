// Copies the face-api model weights from node_modules into public/models so the
// browser can load them from the same origin. public/models is git-ignored
// (about 12 MB of binaries); this runs automatically before `dev` and `build`.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "node_modules", "@vladmandic", "face-api", "model");
const to = path.join(root, "public", "models");

// Must match the pipeline in src/lib/face-engine.ts (detector + landmarks + recognition net).
const NAMES = ["ssd_mobilenetv1_model", "face_landmark_68_model", "face_recognition_model"];

if (!existsSync(from)) {
  console.error("face-api models not found. Run `npm install` in frontend/ first.");
  process.exit(1);
}
mkdirSync(to, { recursive: true });
for (const name of NAMES) {
  for (const file of [`${name}-weights_manifest.json`, `${name}.bin`]) {
    copyFileSync(path.join(from, file), path.join(to, file));
  }
}
console.log(`face-api models copied to ${path.relative(root, to)}`);
