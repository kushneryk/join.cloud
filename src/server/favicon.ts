import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const FAVICON_SVG = readFileSync(join(__dirname, "../../public/favicon.svg"), "utf-8");
