/**
 * Memory Component Types
 */

/**
 * Memory statistics
 */
export interface MemoryStats {
  totalChunks: number;
  criticalChunks: number;
  forgottenChunks: number;
  compressibleChunks: number;
}
