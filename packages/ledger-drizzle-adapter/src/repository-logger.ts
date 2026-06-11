export interface RepositoryLogger {
  info(context: Record<string, unknown>, message: string): void;
}
