interface PublishedPackage {
  name: string;
  version: string;
}

/** What one PR shipped: the packages its changeset named, and those bumped because of it. */
interface ReleaseEntry {
  /** Packages the PR's changeset named directly. */
  direct: Set<string>;
  /** Packages republished only because they depend on a direct one. */
  dependents: Set<string>;
}

/** PR number -> what it shipped in. */
type Released = Map<number, ReleaseEntry>;

type ResolveVia = 'auto' | 'changesets' | 'changelog';

export type { PublishedPackage, Released, ReleaseEntry, ResolveVia };
