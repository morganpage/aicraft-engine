/**
 * Type declarations for `fix-esm-specifiers.mjs`, so that test files importing
 * the script type-check under `tsc --noEmit` without `allowJs`. The runtime
 * implementation is the sibling `.mjs`; this file describes its public API only.
 */

export interface FsResolvers {
  existsFile: (path: string) => boolean;
  existsDir: (path: string) => boolean;
}

export type SpecifierExt = 'js' | 'd.ts';

export function resolveRelativeSpecifier(
  specifier: string,
  fromFileDir: string,
  ext: SpecifierExt,
  resolvers?: FsResolvers,
): string;

export const defaultResolvers: FsResolvers;

export type SourceSegment = { type: 'code' | 'comment' | 'string'; text: string };

export function splitCodeAndComments(src: string): SourceSegment[];

export function rewriteSource(
  source: string,
  fromFileDir: string,
  ext: SpecifierExt,
  resolvers?: FsResolvers,
): { source: string; changed: number };
