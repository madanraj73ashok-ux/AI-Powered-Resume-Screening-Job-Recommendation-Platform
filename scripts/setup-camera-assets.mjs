// Explicit asset provisioning. All inference assets are served from this app.
import { mkdir, copyFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'frontend/public/mediapipe');
await mkdir(destination, { recursive: true });
await mkdir(path.join(root, 'frontend/public/models'), { recursive: true });
const source = path.join(root, 'frontend/node_modules/@mediapipe/tasks-vision/wasm');
for (const file of await readdir(source)) await copyFile(path.join(source, file), path.join(destination, file));
const response = await fetch('https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite');
if (!response.ok) throw new Error(`Face model download failed: ${response.status}`);
await writeFile(path.join(root, 'frontend/public/models/blaze_face_short_range.tflite'), new Uint8Array(await response.arrayBuffer()));
console.log('Local camera assets ready (~230 KB model plus installed MediaPipe WASM).');
