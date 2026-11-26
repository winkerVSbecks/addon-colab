// Loads the addon from src/ (no tsup build), so the checks test the source as it is.
import { fileURLToPath } from 'node:url';

export function previewAnnotations(entry: string[] = []) {
  return [...entry, fileURLToPath(import.meta.resolve('../../src/preview.ts'))];
}

export function managerEntries(entry: string[] = []) {
  return [...entry, fileURLToPath(import.meta.resolve('../../src/manager.tsx'))];
}

export * from '../../src/preset.ts';
