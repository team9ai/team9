export interface PageDto {
  path: string;
  content: string;
  encoding: 'text' | 'base64';
  frontmatter: Record<string, unknown>;
  lastCommit: {
    sha: string;
    author: string | null;
    timestamp: string | null;
  } | null;
}
