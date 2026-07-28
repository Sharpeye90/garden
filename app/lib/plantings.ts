import type {
  GardenTask,
  Plant,
  Planting,
  PlantingMode,
  PlanObject,
  PlanObjectType,
} from "../types";
import { dateKey } from "./dates";

const COMPATIBLE_TARGETS: Record<Plant["kind"], PlanObjectType[]> = {
  Овощи: ["bed", "greenhouse"],
  Плодовые: ["zone"],
  Декоративные: ["flowerbed", "bed", "zone"],
};

export function plantingModeForPlant(plant: Plant): PlantingMode {
  if (plant.kind === "Плодовые") return "point";
  if (plant.kind === "Декоративные") return "group";
  return "area";
}

export function placementHintForPlant(plant: Plant): string {
  if (plant.kind === "Овощи") {
    return "Нажмите внутри грядки или теплицы.";
  }
  if (plant.kind === "Декоративные") {
    return "Нажмите внутри клумбы, грядки или произвольной зоны.";
  }
  return "Нажмите в точке посадки дерева или кустарника.";
}

export function requiresPlanObject(plant: Plant): boolean {
  return plant.kind !== "Плодовые";
}

function containsPoint(object: PlanObject, x: number, y: number): boolean {
  return (
    x >= object.x &&
    x <= object.x + object.width &&
    y >= object.y &&
    y <= object.y + object.height
  );
}

export function findPlacementTarget(
  objects: PlanObject[],
  plant: Plant,
  x: number,
  y: number,
): PlanObject | null {
  const allowed = COMPATIBLE_TARGETS[plant.kind];
  return (
    [...objects]
      .reverse()
      .find((object) => allowed.includes(object.type) && containsPoint(object, x, y)) ??
    null
  );
}

export function zoneForPlacement(plant: Plant, target: PlanObject | null): string {
  if (target) return target.label;
  return plant.kind === "Плодовые" ? "Плодовый сад" : "Участок";
}

export function createCareTask(
  plant: Plant,
  planting: Planting,
  zone: string,
): GardenTask {
  const common = {
    id: `care-${planting.id}`,
    scheduledFor: dateKey(),
    zone,
    window: "сегодня–завтра",
    priority: "normal" as const,
    risk: "low" as const,
    status: "todo" as const,
    completedItems: 0,
    totalItems: Math.max(1, planting.quantity),
    plantId: plant.id,
    plantingId: planting.id,
  };

  if (plant.kind === "Овощи") {
    return {
      ...common,
      title: `Проверить влажность: ${plant.name}`,
      time: `${Math.min(15, 4 + planting.quantity)} мин`,
      why: `Посадка «${plant.name}» только что добавлена. Проверьте почву пальцем на глубине 2–3 см и поливайте только при подсыхании.`,
      ruleId: "observe.soil-moisture.vegetable.v1",
    };
  }

  if (plant.kind === "Плодовые") {
    return {
      ...common,
      title: `Осмотреть посадку: ${plant.name}`,
      time: "7 мин",
      why: `Для новой записи «${plant.name}» пока мало наблюдений. Отметьте состояние листьев, почвы и текущую стадию без применения препаратов.`,
      ruleId: "observe.planting.fruit.v1",
    };
  }

  return {
    ...common,
    title: `Проверить посадку: ${plant.name}`,
    time: `${Math.min(15, 5 + planting.quantity)} мин`,
    why: `Уточните состояние почвы и стадию «${plant.name}». Это поможет скорректировать календарь цветения и последующий уход.`,
    ruleId: "observe.planting.decorative.v1",
  };
}
