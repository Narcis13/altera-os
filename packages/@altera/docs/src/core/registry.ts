import { DocsError } from './errors.ts';
import type { ComponentTypeDefinition, ComponentTypeManifest } from './types.ts';

const registry = new Map<string, ComponentTypeDefinition>();

function registryKey(type: string, mode?: string): string {
  return mode ? `${type}:${mode}` : type;
}

export function registerComponentType(def: ComponentTypeDefinition): void {
  const key = registryKey(def.type, def.mode);
  if (registry.has(key)) {
    throw new DocsError(
      'DUPLICATE_COMPONENT_TYPE',
      `Component type "${def.type}" (mode: ${def.mode}) is already registered`,
    );
  }
  registry.set(key, def);
}

export function getComponentType(
  type: string,
  mode?: string,
): ComponentTypeDefinition | undefined {
  if (mode) {
    const exact = registry.get(registryKey(type, mode));
    if (exact) return exact;
  }
  return (
    registry.get(registryKey(type, 'read')) ??
    registry.get(registryKey(type, 'input')) ??
    registry.get(type)
  );
}

export function getComponentTypeManifest(): ComponentTypeManifest[] {
  return Array.from(registry.values()).map(
    ({ type, label, description, agentHint, mode, defaultConstraints }) => ({
      type,
      label,
      description,
      mode,
      ...(agentHint ? { agentHint } : {}),
      ...(defaultConstraints ? { defaultConstraints } : {}),
    }),
  );
}

export function clearRegistry(): void {
  registry.clear();
}
