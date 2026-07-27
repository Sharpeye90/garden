export type ViewId = "today" | "plan" | "plants" | "bloom" | "journal";

export type TaskStatus = "todo" | "partial" | "done" | "skipped";

export type GardenTask = {
  id: string;
  title: string;
  zone: string;
  time: string;
  window: string;
  why: string;
  priority: "high" | "normal" | "low";
  risk: "low" | "review";
  status: TaskStatus;
  completedItems: number;
  totalItems: number;
  ruleId: string;
};

export type PlanObjectType =
  | "house"
  | "greenhouse"
  | "building"
  | "bed"
  | "flowerbed"
  | "lawn"
  | "pond"
  | "path"
  | "tree"
  | "shrub"
  | "zone";

export type PlanObject = {
  id: string;
  type: PlanObjectType;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color: string;
  season: "permanent" | "2026" | "2027";
  locked?: boolean;
};

export type PlantKind = "Овощи" | "Плодовые" | "Декоративные";

export type Plant = {
  id: string;
  name: string;
  latinName: string;
  kind: PlantKind;
  zone: string;
  countLabel: string;
  bloomStart?: number;
  bloomEnd?: number;
  bloomColor?: string;
  careCoverage: "full" | "basic" | "custom";
  stage: string;
};

export type JournalEntry = {
  id: string;
  date: string;
  title: string;
  note: string;
  zone: string;
};

export type GardenState = {
  revision: number;
  tasks: GardenTask[];
  planObjects: PlanObject[];
  plants: Plant[];
  journal: JournalEntry[];
  lastAnalyzedAt: string;
};
