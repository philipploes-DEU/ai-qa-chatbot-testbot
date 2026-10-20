import { type Goldset, GoldsetSchema } from "../domain/goldset.js";
import { loadDocument } from "../io/yaml.js";

export function loadGoldset(file: string): Promise<Goldset> {
  return loadDocument(GoldsetSchema, file);
}
