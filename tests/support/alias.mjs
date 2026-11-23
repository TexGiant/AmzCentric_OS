// Lets tests import app code that uses the "@/…" path alias (tsconfig paths → src/).
// Usage: node --import ./tests/support/alias.mjs --test …
import { register } from "node:module";
register("./alias-hooks.mjs", import.meta.url);
