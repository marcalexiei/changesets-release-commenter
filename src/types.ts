export interface PublishedPackage {
  name: string;
  version: string;
}

/** PR number -> the `name@version` list it shipped in. */
export type Released = Map<number, Set<string>>;

export type ResolveVia = 'auto' | 'changesets' | 'changelog';
