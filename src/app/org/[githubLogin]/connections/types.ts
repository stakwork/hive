/**
 * Shape of a single connection doc — a workspace-graph artifact the
 * agent maintains describing how systems work together. Surfaced on
 * the canvas's right panel (Connections tab) and openable in
 * `ConnectionViewer`.
 */
export interface ConnectionData {
  id: string;
  slug: string;
  name: string;
  summary: string;
  diagram: string | null;
  architecture: string | null;
  openApiSpec: string | null;
  createdAt: string;
  updatedAt: string;
}
