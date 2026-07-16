// Domain types mirroring the FastAPI backend models.

export type SunlightLevel = "low" | "medium" | "bright_indirect" | "direct";

export type HealthStatus =
  | "thriving"
  | "healthy"
  | "struggling"
  | "critical"
  | "dormant"
  | "deceased";

export type EventType =
  | "watered"
  | "fertilized"
  | "repotted"
  | "pruned"
  | "pest_treatment"
  | "note"
  | "health_change"
  | "moved";

export interface TemperatureRange {
  min_c?: number | null;
  max_c?: number | null;
}

export interface HumidityRange {
  min_pct?: number | null;
  max_pct?: number | null;
}

export interface CareDefaults {
  watering_interval_days?: number | null;
  watering_notes?: string | null;
  sunlight?: SunlightLevel | null;
  light_notes?: string | null;
  fertilizing_interval_days?: number | null;
  fertilizer_type?: string | null;
  fertilizer_notes?: string | null;
  repotting_interval_months?: number | null;
  soil_type?: string | null;
  pot_size?: string | null;
  humidity?: HumidityRange | null;
  temperature?: TemperatureRange | null;
  hardiness_zone?: string | null;
  mature_size?: string | null;
  pruning_notes?: string | null;
  propagation_notes?: string | null;
  pests_notes?: string | null;
  toxic_to_pets?: boolean | null;
  care_notes?: string | null;
}

export interface PlantClass {
  id: string;
  property_id: string;
  common_name: string;
  scientific_name?: string | null;
  family?: string | null;
  genus?: string | null;
  description?: string | null;
  tags: string[];
  care_defaults: CareDefaults;
  hero_image_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CareEvent {
  id: string;
  type: EventType;
  occurred_at: string;
  notes?: string | null;
  treatment?: string | null;
  new_health_status?: HealthStatus | null;
  created_at: string;
}

export interface CareStatus {
  watering_next_due?: string | null;
  watering_overdue: boolean;
  days_until_watering?: number | null;
  fertilizing_next_due?: string | null;
  fertilizing_overdue: boolean;
  effective_care: CareDefaults;
}

export interface PlantInstance {
  id: string;
  property_id: string;
  class_id: string;
  garden_id: string;
  nickname?: string | null;
  location?: string | null;
  acquisition_date?: string | null;
  pot_size?: string | null;
  soil_type?: string | null;
  health_status: HealthStatus;
  care_overrides: CareDefaults;
  image_urls: string[];
  tag_ids: string[];
  notes?: string | null;
  last_watered_at?: string | null;
  last_fertilized_at?: string | null;
  last_repotted_at?: string | null;
  events: CareEvent[];
  created_at: string;
  updated_at: string;
  care_status: CareStatus;
  scan_url?: string | null;
  plant_class?: PlantClass | null;
}

export interface DashboardSummary {
  total_plants: number;
  total_species: number;
  watering_overdue_count: number;
  watering_due_soon_count: number;
  needs_attention_count: number;
  watering_overdue: PlantInstance[];
  watering_due_soon: PlantInstance[];
  needs_attention: PlantInstance[];
}

// ---- Multitenancy: Property -> Garden -> Plant ----

export type MemberRole = "owner" | "member";

export type TagScope = "property" | "garden" | null;

export interface Garden {
  id: string;
  property_id: string;
  name: string;
  description?: string | null;
  is_home: boolean;
  created_at: string;
  updated_at: string;
}

export interface Property {
  id: string;
  property_id: string;
  name: string;
  address?: string | null;
  owner_oid: string;
  owner_email?: string | null;
  role: MemberRole;
  gardens: Garden[];
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface Membership {
  id: string;
  property_id: string;
  user_oid?: string | null;
  user_email: string;
  user_name?: string | null;
  role: MemberRole;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  property_id: string;
  name: string;
  color?: string | null;
  scope?: TagScope;
  garden_id?: string | null;
  created_at: string;
  updated_at: string;
}
