export type PlaceReviewType =
  | "osm"
  | "a11y"
  | "bathroom"
  | "welfare"
  | "parking"
  | "google";

export type EntranceAccessibility =
  | "step_free"
  | "ramp"
  | "stairs_with_assistance"
  | "inaccessible";

export interface ReviewEvidence {
  entranceAccessibility?: EntranceAccessibility;
  toiletTurningRoom?: boolean;
  wheelchairTableHeight?: boolean;
  adequateAisleWidth?: boolean;
  staffHelpfulnessRating?: number;
}

export interface ReviewItem extends ReviewEvidence {
  aggregateAccessibilityScore?: number;
  _id: string;
  userId: string;
  rating: number;
  passageWidthRating: number;
  toiletRating: number;
  elevatorRating: number;
  serviceRating: number;
  comment?: string;
  createdAt: string;
}

export interface CreateReviewInput extends ReviewEvidence {
  placeId: string;
  placeType: PlaceReviewType;
  passageWidthRating: number;
  toiletRating: number;
  elevatorRating: number;
  serviceRating: number;
  comment?: string;
}

export interface UpdateReviewInput extends ReviewEvidence {
  passageWidthRating?: number;
  toiletRating?: number;
  elevatorRating?: number;
  serviceRating?: number;
  comment?: string;
}

export interface ReviewListResult {
  items: ReviewItem[];
  avgRating: number | null;
  totalCount: number;
  page: number;
  totalPages: number;
}

export interface ReviewSummaryResult {
  avgRating: number | null;
  totalCount: number;
  summary: string | null;
  highlights: string[] | null;
}
