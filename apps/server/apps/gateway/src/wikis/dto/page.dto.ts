export interface PageDto {
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  lastCommit: {
    sha: string;
    author: string | null;
    timestamp: string | null;
  } | null;
}
