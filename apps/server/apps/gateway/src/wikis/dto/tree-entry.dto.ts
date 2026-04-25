export interface TreeEntryDto {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
}
