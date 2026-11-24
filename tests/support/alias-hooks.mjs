import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");
const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** "@/lib/x" → src/lib/x.ts (or .tsx, or x/index.ts); relative imports without an extension get one too. */
export async function resolve(specifier, context, nextResolve) {
  let base = null;
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:") && !path.extname(specifier)) {
    base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  }
  if (base) {
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (isFile(candidate)) return nextResolve(pathToFileURL(candidate).href, context);
    }
  }
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // Packages like "next/server" have no exports map; plain Node ESM needs the ".js".
    if (err?.code === "ERR_MODULE_NOT_FOUND" && /^[^./][^:]*\/[^.]+$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
    throw err;
  }
}
