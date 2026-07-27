import type { GardenTask, PlanObject } from "../types";

export function snap(value: number, grid = 10): number {
  return Math.round(value / grid) * grid;
}

export function completeTask(task: GardenTask): GardenTask {
  return {
    ...task,
    status: "done",
    completedItems: task.totalItems,
  };
}

export function partiallyCompleteTask(task: GardenTask): GardenTask {
  const nextCount = Math.min(
    task.totalItems,
    Math.max(1, task.completedItems + 1),
  );
  return {
    ...task,
    status: nextCount === task.totalItems ? "done" : "partial",
    completedItems: nextCount,
  };
}

export function updatePlanObject(
  objects: PlanObject[],
  changed: PlanObject,
): PlanObject[] {
  return objects.map((object) => (object.id === changed.id ? changed : object));
}
