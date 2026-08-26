import type { ClassField, SubprogramDecl } from '../parser/ast';

export type Access = 'PUBLIC' | 'PRIVATE';

export interface ClassMethod {
  decl: SubprogramDecl;
  access: Access;
  /** The class that declared it, which is what SUPER and access checks use. */
  owner: ClassInfo;
}

export interface ClassInfo {
  name: string;
  parent: ClassInfo | null;
  /** Own fields only; use `allFields` for the inherited view. */
  fields: Map<string, ClassField>;
  methods: Map<string, ClassMethod>;
}

/** Constructors are procedures named NEW (guide section 10.2). */
export const CONSTRUCTOR = 'new';

export function findMethod(cls: ClassInfo | null, name: string): ClassMethod | undefined {
  const key = name.toLowerCase();
  for (let c = cls; c !== null; c = c.parent) {
    const found = c.methods.get(key);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function findField(cls: ClassInfo | null, name: string): { field: ClassField; owner: ClassInfo } | undefined {
  const key = name.toLowerCase();
  for (let c = cls; c !== null; c = c.parent) {
    const found = c.fields.get(key);
    if (found !== undefined) return { field: found, owner: c };
  }
  return undefined;
}

/** Parent classes first, so a subclass field shadows nothing unexpectedly. */
export function allFields(cls: ClassInfo): ClassField[] {
  const chain: ClassInfo[] = [];
  for (let c: ClassInfo | null = cls; c !== null; c = c.parent) chain.unshift(c);
  return chain.flatMap((c) => [...c.fields.values()]);
}

export function isSubclassOf(cls: ClassInfo | null, ancestor: ClassInfo): boolean {
  for (let c = cls; c !== null; c = c.parent) {
    if (c === ancestor) return true;
  }
  return false;
}

export function inheritanceChain(cls: ClassInfo): string[] {
  const names: string[] = [];
  for (let c: ClassInfo | null = cls; c !== null; c = c.parent) names.push(c.name);
  return names;
}
