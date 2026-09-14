interface PublishedPackage {
  name: string;
  version: string;
}

/** PR number -> the `name@version` list it shipped in. */
type Released = Map<number, Set<string>>;

type ResolveVia = 'auto' | 'changesets' | 'changelog';

export type { PublishedPackage, Released, ResolveVia };
