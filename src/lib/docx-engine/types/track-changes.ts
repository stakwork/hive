/**
 * Track change types, statuses, and the core TrackChangeMark type.
 */

export enum TrackChangeType {
  INSERTION = "insertion",
  DELETION = "deletion",
  REPLACEMENT = "replacement",
}

export enum TrackChangeStatus {
  PENDING = "pending",
  ACCEPTED = "accepted",
  REJECTED = "rejected",
}

export interface TrackChangeMark {
  id: string;
  type: TrackChangeType;
  status: TrackChangeStatus;
  author: string;
  date: string; // ISO 8601
}
