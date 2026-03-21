export interface User {
  id: string;
  nickname: string;
  token: string;
  invite_code: string;
  status: "pending" | "active" | "frozen";
  created_at: string;
}

export interface Profile {
  user_id: string;
  city: string | null;
  company: string | null;
  role: string | null;
  skills: string[];
  bio: string | null;
  available: string[];
  languages: string[];
  updated_at: string;
}

export interface Coffee {
  id: string;
  creator_id: string;
  topic: string;
  description: string | null;
  city: string | null;
  location: string | null;
  scheduled_at: string | null;
  max_size: number;
  status: "open" | "full" | "confirmed" | "completed" | "cancelled";
  tags: string[];
  created_at: string;
}

export interface CoffeeParticipant {
  coffee_id: string;
  user_id: string;
  role: "creator" | "participant";
  joined_at: string;
}

export interface Need {
  id: string;
  user_id: string;
  type: string;
  description: string;
  tags: string[];
  status: "open" | "matched" | "closed";
  created_at: string;
}

export interface Offer {
  id: string;
  user_id: string;
  type: string;
  description: string;
  tags: string[];
  status: "open" | "matched" | "closed";
  created_at: string;
}

export interface Feedback {
  id: string;
  target_type: "coffee" | "project";
  target_id: string;
  from_user: string;
  rating: number;
  tags: string[];
  comment: string | null;
  created_at: string;
}
