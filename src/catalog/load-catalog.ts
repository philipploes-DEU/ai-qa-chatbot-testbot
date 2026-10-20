import { fileURLToPath } from "node:url";

import { type Catalog, CatalogSchema } from "../domain/catalog.js";
import { type ProbeCatalog, ProbeCatalogSchema } from "../domain/probe-catalog.js";
import { loadDocument } from "../io/yaml.js";

export function loadCatalog(file: string): Promise<Catalog> {
  return loadDocument(CatalogSchema, file);
}

export function loadProbeCatalog(file: string | URL): Promise<ProbeCatalog> {
  return loadDocument(ProbeCatalogSchema, typeof file === "string" ? file : fileURLToPath(file));
}
