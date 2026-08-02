"use client";

import dynamic from "next/dynamic";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CATALOG, INITIAL_STATE, MONTHS, PLAN_COLORS } from "../data";
import { completeTask, partiallyCompleteTask, updatePlanObject } from "../lib/domain";
import {
  dateKey,
  dayDistance,
  formatLongDate,
  formatShortDate,
  relativeDayLabel,
  shiftDateKey,
} from "../lib/dates";
import {
  createCareTask,
  findPlacementTarget,
  placementHintForPlant,
  plantingModeForPlant,
  requiresPlanObject,
  zoneForPlacement,
} from "../lib/plantings";
import {
  readLocalState,
  readRemoteState,
  syncRemoteState,
  writeLocalState,
} from "../lib/storage";
import type {
  GardenLocation,
  GardenState,
  GardenTask,
  PlanObject,
  PlanObjectType,
  Plant,
  Planting,
  PlantKind,
  ViewId,
} from "../types";

const GardenCanvas = dynamic(() => import("./GardenCanvas"), {
  ssr: false,
  loading: () => <div className="canvas-loading">Готовим план участка…</div>,
});

type GardenAppProps = {
  userName: string;
  userEmail: string | null;
  isPreview: boolean;
  emailDeliveryEnabled: boolean;
};

const NAV_ITEMS: Array<{ id: ViewId; label: string; short: string }> = [
  { id: "today", label: "Сегодня", short: "Сегодня" },
  { id: "plan", label: "План участка", short: "План" },
  { id: "plants", label: "Растения", short: "Растения" },
  { id: "bloom", label: "Цветение", short: "Цветение" },
  { id: "journal", label: "Журнал", short: "Журнал" },
];

const OBJECT_LABELS: Record<PlanObjectType, string> = {
  house: "Дом",
  greenhouse: "Теплица",
  building: "Постройка",
  bed: "Грядка",
  flowerbed: "Клумба",
  lawn: "Газон",
  pond: "Водоём",
  path: "Дорожка",
  tree: "Дерево",
  shrub: "Куст",
  zone: "Зона",
};

const WEATHER_FALLBACK = {
  temperature: 24,
  apparentTemperature: 23,
  precipitation: 35,
  wind: 2.8,
  description: "Переменная облачность",
};

type WeatherDay = {
  date: string;
  precipitation: number;
  temperatureMax: number;
  temperatureMin: number;
};

type WeatherState = {
  current: typeof WEATHER_FALLBACK;
  daily: WeatherDay[];
  attribution: string | null;
};

type LocationSearchResult = {
  id: string;
  name: string;
  region: string;
  area: string | null;
  latitude: number;
  longitude: number;
};

type PlanHistoryEntry = Pick<
  GardenState,
  "planObjects" | "plantings" | "plants" | "tasks"
>;

const DEFAULT_WEATHER: WeatherState = {
  current: WEATHER_FALLBACK,
  daily: [],
  attribution: null,
};

function roundedWeatherCoordinate(value: number): number {
  return Math.round(value * 20) / 20;
}

function regionForCoordinates(latitude: number, longitude: number): string {
  if (latitude >= 54.8 && latitude < 56.15 && longitude >= 35 && longitude <= 41) {
    return "Московская область";
  }
  if (latitude >= 55.6 && latitude <= 59.2 && longitude >= 30.5 && longitude <= 39.6) {
    return "Тверская область";
  }
  return "Вне региона пилота";
}

function plantCountLabel(quantity: number): string {
  const remainder100 = quantity % 100;
  const remainder10 = quantity % 10;
  if (remainder100 >= 11 && remainder100 <= 14) return `${quantity} растений`;
  if (remainder10 === 1) return `${quantity} растение`;
  if (remainder10 >= 2 && remainder10 <= 4) return `${quantity} растения`;
  return `${quantity} растений`;
}

function russianCount(
  quantity: number,
  one: string,
  few: string,
  many: string,
): string {
  const remainder100 = quantity % 100;
  const remainder10 = quantity % 10;
  if (remainder100 >= 11 && remainder100 <= 14) return `${quantity} ${many}`;
  if (remainder10 === 1) return `${quantity} ${one}`;
  if (remainder10 >= 2 && remainder10 <= 4) return `${quantity} ${few}`;
  return `${quantity} ${many}`;
}

function Logo() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span />
      <span />
    </div>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: "green" | "sand" | "rose" | "blue";
  children: React.ReactNode;
}) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

export function GardenApp({
  userName,
  userEmail,
  isPreview,
  emailDeliveryEnabled,
}: GardenAppProps) {
  const [view, setView] = useState<ViewId>("today");
  const [state, setState] = useState<GardenState>(INITIAL_STATE);
  const [selectedDate, setSelectedDate] = useState(dateKey);
  const [hydrated, setHydrated] = useState(false);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [syncStatus, setSyncStatus] = useState<"saved" | "saving" | "offline">(
    "saved",
  );
  const [selectedTask, setSelectedTask] = useState<string | null>(
    INITIAL_STATE.tasks[0]?.id ?? null,
  );
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedPlantingId, setSelectedPlantingId] = useState<string | null>(null);
  const [pendingPlantId, setPendingPlantId] = useState<string | null>(null);
  const [planHistory, setPlanHistory] = useState<PlanHistoryEntry[]>([]);
  const [zoom, setZoom] = useState(1);
  const [season, setSeason] = useState<"all" | "permanent" | "2026" | "2027">(
    "all",
  );
  const [plantQuery, setPlantQuery] = useState("");
  const [plantFilter, setPlantFilter] = useState<"Все" | PlantKind>("Все");
  const [journalDraft, setJournalDraft] = useState("");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [clearPlanConfirmOpen, setClearPlanConfirmOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherState>(DEFAULT_WEATHER);
  const [weatherStatus, setWeatherStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "requesting" | "denied" | "unsupported"
  >("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadState = async () => {
      const [local, previewLocal, remote] = await Promise.all([
        readLocalState(userEmail),
        userEmail ? readLocalState(null) : Promise.resolve(null),
        isPreview ? Promise.resolve(null) : readRemoteState(),
      ]);
      return remote ?? local ?? previewLocal;
    };
    loadState()
      .then((saved) => {
        if (!cancelled && saved) setState(saved);
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isPreview, userEmail]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      setSyncStatus("saving");
    };
    const handleOffline = () => {
      setOnline(false);
      setSyncStatus("offline");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({
      latitude: String(state.location.latitude),
      longitude: String(state.location.longitude),
    });
    fetch(`/api/v1/weather?${params}`)
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{
              current?: typeof WEATHER_FALLBACK;
              daily?: {
                time: string[];
                precipitation_probability_max: number[];
                temperature_2m_max: number[];
                temperature_2m_min: number[];
              };
              attribution?: string;
            }>)
          : null,
      )
      .then((payload) => {
        if (!payload?.current) {
          setWeatherStatus("error");
          return;
        }
        setWeather({
          current: payload.current,
          daily: (payload.daily?.time ?? []).map((date, index) => ({
            date,
            precipitation:
              payload.daily?.precipitation_probability_max[index] ?? 0,
            temperatureMax: payload.daily?.temperature_2m_max[index] ?? 0,
            temperatureMin: payload.daily?.temperature_2m_min[index] ?? 0,
          })),
          attribution: payload.attribution ?? null,
        });
        setWeatherStatus("ready");
      })
      .catch(() => setWeatherStatus("error"));
  }, [state.location.latitude, state.location.longitude]);

  useEffect(() => {
    if (!hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await writeLocalState(state, userEmail);
      if (isPreview) {
        setSyncStatus("saved");
        return;
      }
      if (!online) {
        setSyncStatus("offline");
        return;
      }
      const result = await syncRemoteState(state);
      setSyncStatus(result ? "saved" : "offline");
    }, 450);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, hydrated, online, isPreview, userEmail]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const authStatus = url.searchParams.get("auth");
    if (!authStatus) return;
    const timer = window.setTimeout(() => {
      setToast(
        authStatus === "success"
          ? "Вход выполнен — сад теперь сохраняется в вашем аккаунте"
          : authStatus === "expired"
            ? "Ссылка устарела или уже использована — запросите новую"
            : "Не удалось подтвердить вход — запросите новую ссылку",
      );
    }, 0);
    url.searchParams.delete("auth");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [view]);

  const updateState = useCallback((updater: (current: GardenState) => GardenState) => {
    setState((current) => {
      const next = updater(current);
      return { ...next, revision: current.revision + 1 };
    });
  }, []);

  const dayTasks = state.tasks.filter((task) => task.scheduledFor === selectedDate);
  const visibleTasks = dayTasks.filter(
    (task) => task.status !== "done" && task.status !== "skipped",
  );
  const selectedTaskData =
    visibleTasks.find((task) => task.id === selectedTask) ?? visibleTasks[0] ?? null;
  const finishedCount = dayTasks.filter((task) => task.status === "done").length;
  const progress = Math.round((finishedCount / Math.max(1, dayTasks.length)) * 100);
  const todayTaskCount = state.tasks.filter(
    (task) =>
      task.scheduledFor === dateKey() &&
      task.status !== "done" &&
      task.status !== "skipped",
  ).length;
  const selectedWeatherDay = weather.daily.find((day) => day.date === selectedDate) ?? null;

  const selectDate = (value: string) => {
    const distance = dayDistance(value);
    if (distance < -14 || distance > 15) {
      setToast("Доступны две прошедшие недели и прогноз на 16 дней");
      return;
    }
    setSelectedDate(value);
    setView("today");
  };

  const requestLocation = () => {
    if (!("geolocation" in navigator)) {
      setLocationStatus("unsupported");
      setToast("Это устройство не поддерживает определение местоположения");
      return;
    }
    setLocationStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = roundedWeatherCoordinate(position.coords.latitude);
        const longitude = roundedWeatherCoordinate(position.coords.longitude);
        const region = regionForCoordinates(latitude, longitude);
        const location: GardenLocation = {
          latitude,
          longitude,
          label: "Моя погодная точка",
          region,
          source: "device",
          updatedAt: new Date().toISOString(),
        };
        setWeatherStatus("loading");
        updateState((current) => ({ ...current, location }));
        setLocationStatus("idle");
        setLocationOpen(false);
        setToast(
          region === "Вне региона пилота"
            ? "Точка сохранена, но погодные правила пилота здесь пока не работают"
            : "Местоположение обновлено; загружаем прогноз",
        );
      },
      (error) => {
        setLocationStatus(error.code === error.PERMISSION_DENIED ? "denied" : "idle");
        setToast(
          error.code === error.PERMISSION_DENIED
            ? "Доступ к геопозиции не разрешён — оставили прежнюю точку"
            : "Не удалось определить место — попробуйте ещё раз на открытом участке",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 3_600_000 },
    );
  };

  const taskAction = (
    taskId: string,
    action: "done" | "partial" | "skip" | "postpone",
  ) => {
    updateState((current) => {
      const sourceTask = current.tasks.find((task) => task.id === taskId);
      const shouldJournal =
        action === "done" && sourceTask && sourceTask.status !== "done";
      return {
        ...current,
        tasks: current.tasks.map((task) => {
          if (task.id !== taskId) return task;
          if (action === "done") return completeTask(task);
          if (action === "partial") return partiallyCompleteTask(task);
          if (action === "skip") return { ...task, status: "skipped" };
          return {
            ...task,
            scheduledFor: shiftDateKey(task.scheduledFor, 1),
            window: "перенесено · пересчитать утром",
            priority: "low",
          };
        }),
        journal: shouldJournal
          ? [
              {
                id: crypto.randomUUID(),
                date: formatShortDate(sourceTask.scheduledFor),
                title: sourceTask.title,
                note: "Выполнено из списка дел — связь с посадкой сохранена.",
                zone: sourceTask.zone,
                plantId: sourceTask.plantId,
                plantingId: sourceTask.plantingId,
              },
              ...current.journal,
            ]
          : current.journal,
      };
    });
    setToast(
      action === "done"
        ? "Готово — запись добавлена в журнал"
        : action === "partial"
          ? "Частичное выполнение сохранено"
          : action === "skip"
            ? "Задача скрыта, календарь будет пересчитан"
            : "Перенесли — проверим погодное окно заново",
    );
  };

  const pushPlanHistory = () => {
    setPlanHistory((history) => [
      ...history.slice(-14),
      {
        planObjects: state.planObjects,
        plantings: state.plantings,
        plants: state.plants,
        tasks: state.tasks,
      },
    ]);
  };

  const changePlanObject = (changed: PlanObject) => {
    pushPlanHistory();
    updateState((current) => {
      const linkedPlantings = current.plantings.filter(
        (planting) => planting.planObjectId === changed.id,
      );
      const linkedPlantIds = new Set(
        linkedPlantings.map((planting) => planting.plantId),
      );
      const linkedPlantingIds = new Set(
        linkedPlantings.map((planting) => planting.id),
      );
      return {
        ...current,
        planObjects: updatePlanObject(current.planObjects, changed),
        plants: current.plants.map((plant) =>
          linkedPlantIds.has(plant.id) ? { ...plant, zone: changed.label } : plant,
        ),
        tasks: current.tasks.map((task) =>
          task.plantingId && linkedPlantingIds.has(task.plantingId)
            ? { ...task, zone: changed.label }
            : task,
        ),
      };
    });
  };

  const addPlanObject = (type: PlanObjectType) => {
    pushPlanHistory();
    const count = state.planObjects.filter((object) => object.type === type).length + 1;
    const size = type === "tree" || type === "shrub" ? 54 : type === "path" ? 48 : 110;
    const object: PlanObject = {
      id: `${type}-${crypto.randomUUID()}`,
      type,
      label: `${OBJECT_LABELS[type]} ${count}`,
      x: 350 + (count % 4) * 20,
      y: 340 + (count % 3) * 20,
      width: size,
      height: type === "path" ? 150 : type === "bed" ? 54 : size * 0.72,
      rotation: 0,
      color: PLAN_COLORS[type],
      season: type === "bed" ? "2027" : "permanent",
    };
    updateState((current) => ({
      ...current,
      planObjects: [...current.planObjects, object],
    }));
    setSelectedObjectId(object.id);
    setToast(`${OBJECT_LABELS[type]} добавлена на план`);
  };

  const undoPlan = () => {
    const previous = planHistory.at(-1);
    if (!previous) return;
    setPlanHistory((history) => history.slice(0, -1));
    updateState((current) => ({ ...current, ...previous }));
    setSelectedObjectId(null);
    setSelectedPlantingId(null);
    setToast("Последнее изменение плана отменено");
  };

  const clearPlan = () => {
    if (state.planObjects.length === 0 && state.plantings.length === 0) {
      setToast("План уже пуст");
      return;
    }
    pushPlanHistory();
    updateState((current) => {
      const plantingIds = new Set(current.plantings.map((planting) => planting.id));
      const plantedPlantIds = new Set(
        current.plantings.map((planting) => planting.plantId),
      );
      return {
        ...current,
        planObjects: [],
        plantings: [],
        plants: current.plants.map((plant) =>
          plantedPlantIds.has(plant.id)
            ? { ...plant, zone: "Нужно разместить" }
            : plant,
        ),
        tasks: current.tasks.filter(
          (task) =>
            task.status === "done" ||
            !task.plantingId ||
            !plantingIds.has(task.plantingId),
        ),
      };
    });
    setSelectedObjectId(null);
    setSelectedPlantingId(null);
    setPendingPlantId(null);
    setSeason("all");
    setToast("План очищен — растения остались в списке");
  };

  const selectedObject = state.planObjects.find(
    (object) => object.id === selectedObjectId,
  );
  const selectedPlanting = state.plantings.find(
    (planting) => planting.id === selectedPlantingId,
  );
  const selectedPlant = state.plants.find(
    (plant) => plant.id === selectedPlanting?.plantId,
  );
  const pendingPlant = state.plants.find((plant) => plant.id === pendingPlantId) ?? null;
  const filteredPlanObjects = state.planObjects.filter(
    (object) => season === "all" || object.season === season,
  );
  const filteredPlantings = state.plantings.filter(
    (planting) => season === "all" || planting.season === season,
  );

  const filteredCatalog = useMemo(() => {
    const normalized = plantQuery.trim().toLowerCase();
    return CATALOG.filter(
      (plant) =>
        (plantFilter === "Все" || plant.kind === plantFilter) &&
        (!normalized ||
          plant.name.toLowerCase().includes(normalized) ||
          plant.latinName.toLowerCase().includes(normalized)),
    );
  }, [plantFilter, plantQuery]);

  const startPlacement = (plantId: string) => {
    const plant = state.plants.find((item) => item.id === plantId);
    if (!plant) return;
    setPendingPlantId(plantId);
    setSelectedObjectId(null);
    setSelectedPlantingId(null);
    setSeason("all");
    setView("plan");
    setToast(`${plant.name}: выберите место на плане`);
  };

  const addPlant = (plant: Plant) => {
    const plantId = crypto.randomUUID();
    updateState((current) => ({
      ...current,
      plants: [
        ...current.plants,
        {
          ...plant,
          id: plantId,
          zone: "Нужно разместить",
          countLabel: "1 растение",
        },
      ],
    }));
    setPendingPlantId(plantId);
    setSelectedObjectId(null);
    setSelectedPlantingId(null);
    setSeason("all");
    setView("plan");
    setToast(`${plant.name} добавлено — укажите место на плане`);
  };

  const placePendingPlant = (x: number, y: number) => {
    if (!pendingPlant) return;
    const boundedX = Math.max(52, Math.min(732, Math.round(x)));
    const boundedY = Math.max(46, Math.min(496, Math.round(y)));
    const target = findPlacementTarget(
      state.planObjects,
      pendingPlant,
      boundedX,
      boundedY,
    );
    if (requiresPlanObject(pendingPlant) && !target) {
      setToast(placementHintForPlant(pendingPlant));
      return;
    }

    const planting: Planting = {
      id: crypto.randomUUID(),
      plantId: pendingPlant.id,
      planObjectId: target?.id ?? null,
      mode: plantingModeForPlant(pendingPlant),
      x: boundedX,
      y: boundedY,
      quantity: 1,
      season: pendingPlant.kind === "Овощи" ? "2026" : "permanent",
    };
    const zone = zoneForPlacement(pendingPlant, target);
    const task = createCareTask(pendingPlant, planting, zone);

    updateState((current) => ({
      ...current,
      plants: current.plants.map((plant) =>
        plant.id === pendingPlant.id
          ? { ...plant, zone, countLabel: plantCountLabel(planting.quantity) }
          : plant,
      ),
      plantings: [...current.plantings, planting],
      tasks: [task, ...current.tasks],
    }));
    setPendingPlantId(null);
    setSelectedObjectId(null);
    setSelectedPlantingId(planting.id);
    setSelectedTask(task.id);
    setToast(`${pendingPlant.name} размещено — задача ухода уже создана`);
  };

  const movePlanting = (plantingId: string, x: number, y: number) => {
    const planting = state.plantings.find((item) => item.id === plantingId);
    const plant = state.plants.find((item) => item.id === planting?.plantId);
    if (!planting || !plant) return;
    const target = findPlacementTarget(state.planObjects, plant, x, y);
    if (requiresPlanObject(plant) && !target) {
      setToast(placementHintForPlant(plant));
      return;
    }
    const zone = zoneForPlacement(plant, target);
    updateState((current) => ({
      ...current,
      plantings: current.plantings.map((item) =>
        item.id === plantingId
          ? { ...item, x, y, planObjectId: target?.id ?? null }
          : item,
      ),
      plants: current.plants.map((item) =>
        item.id === plant.id ? { ...item, zone } : item,
      ),
      tasks: current.tasks.map((task) =>
        task.plantingId === plantingId ? { ...task, zone } : task,
      ),
    }));
    setToast(`${plant.name} перемещено`);
  };

  const updatePlantingQuantity = (plantingId: string, quantity: number) => {
    const safeQuantity = Math.max(1, Math.min(999, Math.round(quantity) || 1));
    const planting = state.plantings.find((item) => item.id === plantingId);
    if (!planting) return;
    updateState((current) => ({
      ...current,
      plantings: current.plantings.map((item) =>
        item.id === plantingId ? { ...item, quantity: safeQuantity } : item,
      ),
      plants: current.plants.map((plant) =>
        plant.id === planting.plantId
          ? { ...plant, countLabel: plantCountLabel(safeQuantity) }
          : plant,
      ),
      tasks: current.tasks.map((task) =>
        task.plantingId === plantingId
          ? { ...task, totalItems: safeQuantity }
          : task,
      ),
    }));
  };

  const removePlanting = (plantingId: string) => {
    const planting = state.plantings.find((item) => item.id === plantingId);
    if (!planting) return;
    updateState((current) => {
      const remaining = current.plantings.filter((item) => item.id !== plantingId);
      const fallback = remaining.find((item) => item.plantId === planting.plantId);
      const fallbackObject = current.planObjects.find(
        (object) => object.id === fallback?.planObjectId,
      );
      return {
        ...current,
        plantings: remaining,
        plants: current.plants.map((plant) =>
          plant.id === planting.plantId
            ? {
                ...plant,
                zone: fallback
                  ? fallbackObject?.label ?? "Плодовый сад"
                  : "Нужно разместить",
              }
            : plant,
        ),
        tasks: current.tasks.filter(
          (task) => task.plantingId !== plantingId || task.status === "done",
        ),
      };
    });
    setSelectedPlantingId(null);
    setToast("Посадка убрана с плана; растение осталось в списке");
  };

  const addJournalEntry = (event: FormEvent) => {
    event.preventDefault();
    const text = journalDraft.trim();
    if (!text) return;
    updateState((current) => ({
      ...current,
      journal: [
        {
          id: crypto.randomUUID(),
          date: formatShortDate(dateKey()),
          title: text,
          note: "Личное наблюдение",
          zone: "Участок",
        },
        ...current.journal,
      ],
    }));
    setJournalDraft("");
    setToast("Наблюдение сохранено");
  };

  const recordBloomObservation = (flowering: boolean) => {
    const plant = state.plants.find((item) => item.name.includes("Гортензия"));
    if (!plant) return;
    const planting = state.plantings.find((item) => item.plantId === plant.id);
    const title = flowering
      ? `${plant.name}: цветение подтверждено`
      : `${plant.name}: пока не цветёт`;
    updateState((current) => ({
      ...current,
      plants: current.plants.map((item) =>
        item.id === plant.id
          ? { ...item, stage: flowering ? "Цветение" : "Бутонизация" }
          : item,
      ),
      journal: [
        {
          id: crypto.randomUUID(),
          date: formatShortDate(dateKey()),
          title,
          note: "Наблюдение учтено в календаре цветения.",
          zone: plant.zone,
          plantId: plant.id,
          plantingId: planting?.id,
        },
        ...current.journal,
      ],
    }));
    setToast("Наблюдение сохранено и связано с растением");
  };

  const askAssistant = async (question: string) => {
    if (isPreview) {
      setToast("Советник появится в закрытом пилоте; календарь работает без него");
      return;
    }
    try {
      const response = await fetch("/api/v1/assistant/questions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      setToast(
        response.ok
          ? "Вопрос поставлен в очередь — ответ придёт уведомлением"
          : "Советник сейчас недоступен; попробуйте позже",
      );
    } catch {
      setToast("Советник сейчас недоступен; базовый календарь продолжает работать");
    }
  };

  const resetDemo = () => {
    if (!window.confirm("Вернуть исходный пример сада и удалить изменения в этом браузере?")) {
      return;
    }
    setState({ ...INITIAL_STATE, revision: state.revision + 1 });
    setSelectedTask(INITIAL_STATE.tasks[0]?.id ?? null);
    setSelectedObjectId(null);
    setSelectedPlantingId(null);
    setPendingPlantId(null);
    setPlanHistory([]);
    setSelectedDate(dateKey());
    setView("today");
    setToast("Демосад возвращён в исходное состояние");
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("today")} aria-label="На главную">
          <Logo />
          <span>
            <strong>Ритм сада</strong>
            <small>спокойно по сезону</small>
          </span>
        </button>

        <nav className="side-nav" aria-label="Основная навигация">
          <p className="nav-eyebrow">Мой участок</p>
          {NAV_ITEMS.map((item, index) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => setView(item.id)}
              data-testid={`nav-${item.id}`}
            >
              <span className="nav-index">0{index + 1}</span>
              {item.label}
              {item.id === "today" && todayTaskCount > 0 && (
                <span className="nav-count">{todayTaskCount}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="season-card">
          <div className="season-art" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p>Сейчас в саду</p>
          <strong>Пик летнего ухода</strong>
          <small>{formatShortDate(dateKey())} · календарь обновлён</small>
        </div>

        <button className="profile-card" onClick={() => setAccountOpen(true)}>
          <span className="avatar">{userName.slice(0, 1).toUpperCase()}</span>
          <span>
            <strong>{userName}</strong>
            <small>{isPreview ? "Демо-сад · данные в браузере" : "Основной сад"}</small>
          </span>
          <span className="profile-more">•••</span>
        </button>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button
            className="location-block"
            onClick={() => setLocationOpen(true)}
            title={`${state.location.latitude.toFixed(2)}, ${state.location.longitude.toFixed(2)}`}
          >
            <span className="location-dot" />
            <span>
              <strong>
                {locationStatus === "requesting" ? "Определяем место…" : state.location.label}
              </strong>
              <small>{state.location.region} · выбрать место</small>
            </span>
          </button>
          <div className="topbar-actions">
            {isPreview && (
              <>
                <button className="sign-in-link" onClick={() => setAccountOpen(true)}>
                  Войти
                </button>
                <button className="demo-reset" onClick={resetDemo}>
                  Сбросить демо
                </button>
              </>
            )}
            <span className={`sync-state ${syncStatus}`}>
              <i />
              {syncStatus === "saving"
                ? "Сохраняем"
                : syncStatus === "offline"
                  ? "Офлайн"
                  : isPreview
                    ? "Сохранено в браузере"
                    : "Всё сохранено"}
            </span>
            <button
              className="assistant-button"
              onClick={() => setAssistantOpen(true)}
              data-testid="assistant-open"
            >
              <span className="spark">✦</span>
              Советник
            </button>
          </div>
        </header>

        <div className="page-content">
          {view === "today" && (
            <TodayView
              userName={userName}
              selectedDate={selectedDate}
              weather={weather.current}
              weatherDay={selectedWeatherDay}
              weatherStatus={weatherStatus}
              progress={progress}
              tasks={visibleTasks}
              plantingCount={state.plantings.length}
              zoneCount={new Set(state.plantings.map((planting) => planting.planObjectId ?? "fruit-garden")).size}
              selectedTask={selectedTaskData ?? null}
              onSelectTask={setSelectedTask}
              onTaskAction={taskAction}
              onOpenPlan={(task) => {
                const planting = state.plantings.find(
                  (item) => item.id === task.plantingId,
                );
                const object = state.planObjects.find(
                  (item) => item.id === planting?.planObjectId || item.label === task.zone,
                );
                setPendingPlantId(null);
                setSelectedPlantingId(planting?.id ?? null);
                setSelectedObjectId(planting ? null : object?.id ?? null);
                setView("plan");
              }}
              onOpenBloom={() => setView("bloom")}
              onPreviousDay={() => selectDate(shiftDateKey(selectedDate, -1))}
              onNextDay={() => selectDate(shiftDateKey(selectedDate, 1))}
              onToday={() => selectDate(dateKey())}
            />
          )}

          {view === "plan" && (
            <PlanView
              objects={filteredPlanObjects}
              plantings={filteredPlantings}
              plants={state.plants}
              selectedObject={selectedObject ?? null}
              selectedObjectId={selectedObjectId}
              selectedPlanting={selectedPlanting ?? null}
              selectedPlant={selectedPlant ?? null}
              pendingPlant={pendingPlant}
              season={season}
              zoom={zoom}
              canUndo={planHistory.length > 0}
              canClear={state.planObjects.length > 0 || state.plantings.length > 0}
              onSeason={setSeason}
              onZoom={setZoom}
              onUndo={undoPlan}
              onClear={() => setClearPlanConfirmOpen(true)}
              onSelect={(id) => {
                setSelectedObjectId(id);
                if (id) setSelectedPlantingId(null);
              }}
              onSelectPlanting={(id) => {
                setSelectedPlantingId(id);
                if (id) setSelectedObjectId(null);
              }}
              onChange={changePlanObject}
              onMovePlanting={movePlanting}
              onPlace={placePendingPlant}
              onCancelPlacement={() => setPendingPlantId(null)}
              onUpdatePlantingQuantity={updatePlantingQuantity}
              onRemovePlanting={removePlanting}
              onOpenPlants={() => setView("plants")}
              onAdd={addPlanObject}
              onDelete={() => {
                if (!selectedObjectId) return;
                if (
                  state.plantings.some(
                    (planting) => planting.planObjectId === selectedObjectId,
                  )
                ) {
                  setToast("Сначала переместите или уберите связанные посадки");
                  return;
                }
                pushPlanHistory();
                updateState((current) => ({
                  ...current,
                  planObjects: current.planObjects.filter(
                    (object) => object.id !== selectedObjectId,
                  ),
                }));
                setSelectedObjectId(null);
                setToast("Объект удалён с плана");
              }}
            />
          )}

          {view === "plants" && (
            <PlantsView
              gardenPlants={state.plants}
              plantings={state.plantings}
              catalog={filteredCatalog}
              query={plantQuery}
              filter={plantFilter}
              onQuery={setPlantQuery}
              onFilter={setPlantFilter}
              onAdd={addPlant}
              onPlace={startPlacement}
              onLocate={(plantId) => {
                const planting = state.plantings.find(
                  (item) => item.plantId === plantId,
                );
                if (!planting) {
                  startPlacement(plantId);
                  return;
                }
                setPendingPlantId(null);
                setSelectedObjectId(null);
                setSelectedPlantingId(planting.id);
                setSeason("all");
                setView("plan");
              }}
            />
          )}

          {view === "bloom" && (
            <BloomView plants={state.plants} onObservation={recordBloomObservation} />
          )}

          {view === "journal" && (
            <JournalView
              entries={state.journal}
              draft={journalDraft}
              onDraft={setJournalDraft}
              onSubmit={addJournalEntry}
            />
          )}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Мобильная навигация">
        {NAV_ITEMS.map((item, index) => (
          <button
            key={item.id}
            className={view === item.id ? "active" : ""}
            onClick={() => setView(item.id)}
          >
            <span>0{index + 1}</span>
            {item.short}
          </button>
        ))}
      </nav>

      {assistantOpen && (
        <AssistantPanel
          state={state}
          isPreview={isPreview}
          onClose={() => setAssistantOpen(false)}
          onAsk={askAssistant}
        />
      )}

      {accountOpen && (
        <AccountPanel
          userName={userName}
          userEmail={userEmail}
          isPreview={isPreview}
          emailDeliveryEnabled={emailDeliveryEnabled}
          onClose={() => setAccountOpen(false)}
        />
      )}

      {locationOpen && (
        <LocationPanel
          currentLocation={state.location}
          locationStatus={locationStatus}
          onDetect={requestLocation}
          onSelect={(selected) => {
            const location: GardenLocation = {
              latitude: roundedWeatherCoordinate(selected.latitude),
              longitude: roundedWeatherCoordinate(selected.longitude),
              label: selected.name,
              region: selected.region,
              source: "search",
              updatedAt: new Date().toISOString(),
            };
            setWeatherStatus("loading");
            updateState((current) => ({ ...current, location }));
            setLocationOpen(false);
            setToast(`${selected.name}: погодная точка сохранена`);
          }}
          onClose={() => setLocationOpen(false)}
        />
      )}

      {clearPlanConfirmOpen && (
        <ClearPlanDialog
          objectCount={state.planObjects.length}
          plantingCount={state.plantings.length}
          onCancel={() => setClearPlanConfirmOpen(false)}
          onConfirm={() => {
            setClearPlanConfirmOpen(false);
            clearPlan();
          }}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function TodayView({
  userName,
  selectedDate,
  weather,
  weatherDay,
  weatherStatus,
  progress,
  tasks,
  plantingCount,
  zoneCount,
  selectedTask,
  onSelectTask,
  onTaskAction,
  onOpenPlan,
  onOpenBloom,
  onPreviousDay,
  onNextDay,
  onToday,
}: {
  userName: string;
  selectedDate: string;
  weather: typeof WEATHER_FALLBACK;
  weatherDay: WeatherDay | null;
  weatherStatus: "loading" | "ready" | "error";
  progress: number;
  tasks: GardenTask[];
  plantingCount: number;
  zoneCount: number;
  selectedTask: GardenTask | null;
  onSelectTask: (id: string) => void;
  onTaskAction: (
    id: string,
    action: "done" | "partial" | "skip" | "postpone",
  ) => void;
  onOpenPlan: (task: GardenTask) => void;
  onOpenBloom: () => void;
  onPreviousDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
}) {
  const isToday = dayDistance(selectedDate) === 0;
  const dateLabel = relativeDayLabel(selectedDate);
  const temperature = isToday
    ? weather.temperature
    : weatherDay
      ? Math.round((weatherDay.temperatureMax + weatherDay.temperatureMin) / 2)
      : weather.temperature;
  const precipitation = weatherDay?.precipitation ?? weather.precipitation;
  return (
    <>
      <section className="welcome-row">
        <div>
          <p className="eyebrow">{formatLongDate(selectedDate)}</p>
          <h1>{isToday ? `Доброе утро, ${userName}` : dateLabel}</h1>
          <p className="lead">
            {isToday
              ? "Сегодня саду понадобится около 45 минут внимания."
              : tasks.length > 0
                ? "Работы и прогноз для выбранного дня."
                : "Запланированных работ на этот день нет."}
          </p>
        </div>
        <div className="welcome-actions">
          <div className="date-switcher" aria-label="Выбор дня">
            <button onClick={onPreviousDay} aria-label="Предыдущий день">←</button>
            <button className={!isToday ? "date-today" : "date-today active"} onClick={onToday}>
              Сегодня
            </button>
            <button onClick={onNextDay} aria-label="Следующий день">→</button>
          </div>
          <button className="outline-button" onClick={onOpenBloom}>
            Календарь цветения <span>→</span>
          </button>
        </div>
      </section>

      <section className={`weather-card weather-${weatherStatus}`}>
        <div className="weather-now">
          <div className="sun-symbol" aria-hidden="true"><i /></div>
          <div>
            <span className="temperature">{temperature > 0 ? "+" : ""}{Math.round(temperature)}°</span>
            <p>{isToday ? weather.description : weatherDay ? "Прогноз на день" : "Прогноз недоступен"}</p>
          </div>
        </div>
        <div className="weather-facts">
          <div>
            <span>{isToday ? "Ощущается" : "Диапазон"}</span>
            <strong>{isToday ? `${weather.apparentTemperature > 0 ? "+" : ""}${Math.round(weather.apparentTemperature)}°` : weatherDay ? `${Math.round(weatherDay.temperatureMin)}…${Math.round(weatherDay.temperatureMax)}°` : "—"}</strong>
          </div>
          <div><span>Вероятность дождя</span><strong>{weatherDay ? `${Math.round(precipitation)}%` : isToday ? `${Math.round(precipitation)}%` : "—"}</strong></div>
          <div><span>{isToday ? "Ветер" : "Горизонт"}</span><strong>{isToday ? `${weather.wind.toFixed(1)} м/с` : weatherDay ? "в прогнозе" : "нет данных"}</strong></div>
        </div>
        <div className="weather-note">
          <span className="note-mark">!</span>
          <p>
            <strong>
              {weatherStatus === "loading"
                ? "Обновляем прогноз для погодной точки."
                : weatherStatus === "error"
                  ? "Погода временно недоступна."
                  : isToday
                    ? "Рекомендации учли сегодняшний прогноз."
                    : weatherDay
                      ? "Задачи показаны для выбранного дня."
                      : "Для этой даты ещё нет прогноза."}
            </strong>
            <br />Погодная точка хранится с округлением примерно до 5 км.
          </p>
        </div>
      </section>

      <div className="today-grid">
        <section className="tasks-section">
          <div className="section-head">
            <div>
              <p className="eyebrow">План на день</p>
              <h2>{tasks.length > 0 ? russianCount(tasks.length, "важное дело", "важных дела", "важных дел") : "На сегодня всё"}</h2>
            </div>
            <div className="progress-compact">
              <span style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}>{progress}%</span>
              <small>готово</small>
            </div>
          </div>

          <div className="task-list">
            {tasks.length === 0 && (
              <div className="empty-card"><strong>Сад на сегодня спокоен</strong><p>Следующий пересчёт — завтра утром.</p></div>
            )}
            {tasks.map((task, index) => (
              <article
                key={task.id}
                className={`task-card ${selectedTask?.id === task.id ? "selected" : ""}`}
                onClick={() => onSelectTask(task.id)}
              >
                <button
                  className="task-check"
                  aria-label={`Выполнить: ${task.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onTaskAction(task.id, "done");
                  }}
                >
                  <span />
                </button>
                <div className="task-copy">
                  <div className="task-meta">
                    <span>{task.zone}</span>
                    <i />
                    <span>{task.time}</span>
                    {task.priority === "high" && <StatusPill tone="rose">важно</StatusPill>}
                  </div>
                  <h3>{task.title}</h3>
                  <p>{task.why}</p>
                  {task.totalItems > 1 && (
                    <div className="task-subprogress">
                      <span style={{ width: `${(task.completedItems / task.totalItems) * 100}%` }} />
                      <small>{task.completedItems} из {task.totalItems} отмечено</small>
                    </div>
                  )}
                </div>
                <div className="task-side">
                  <span className="task-window">{task.window}</span>
                  <span className="task-number">0{index + 1}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="focus-column">
          {selectedTask ? (
            <div className="focus-card">
              <p className="eyebrow">Почему сейчас</p>
              <h3>{selectedTask.title}</h3>
              <p>{selectedTask.why}</p>
              <div className="source-row">
                <span>Правило {selectedTask.ruleId}</span>
                <StatusPill tone="green">высокая уверенность</StatusPill>
              </div>
              <div className="focus-actions">
                <button className="primary-button" onClick={() => onTaskAction(selectedTask.id, "done")}>Выполнено</button>
                <button className="soft-button" onClick={() => onTaskAction(selectedTask.id, "partial")}>Частично</button>
              </div>
              <div className="text-actions">
                <button onClick={() => onTaskAction(selectedTask.id, "postpone")}>Перенести</button>
                <button onClick={() => onTaskAction(selectedTask.id, "skip")}>Неактуально</button>
              </div>
              <button className="zone-link" onClick={() => onOpenPlan(selectedTask)}>
                Показать место на плане <span>↗</span>
              </button>
            </div>
          ) : (
            <div className="focus-card"><p>Выберите задачу, чтобы увидеть объяснение.</p></div>
          )}

          <div className="assistant-summary">
            <div className="assistant-orbit"><span>✦</span></div>
            <div>
              <p className="eyebrow">Ночной анализ</p>
              <h3>Сад выглядит устойчиво</h3>
              <p>Проверено {russianCount(plantingCount, "посадка", "посадки", "посадок")}, {russianCount(zoneCount, "зона", "зоны", "зон")} и прогноз до 16 дней. Новых рисков не найдено.</p>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function PlanView({
  objects,
  plantings,
  plants,
  selectedObject,
  selectedObjectId,
  selectedPlanting,
  selectedPlant,
  pendingPlant,
  season,
  zoom,
  canUndo,
  canClear,
  onSeason,
  onZoom,
  onUndo,
  onClear,
  onSelect,
  onSelectPlanting,
  onChange,
  onMovePlanting,
  onPlace,
  onCancelPlacement,
  onUpdatePlantingQuantity,
  onRemovePlanting,
  onOpenPlants,
  onAdd,
  onDelete,
}: {
  objects: PlanObject[];
  plantings: Planting[];
  plants: Plant[];
  selectedObject: PlanObject | null;
  selectedObjectId: string | null;
  selectedPlanting: Planting | null;
  selectedPlant: Plant | null;
  pendingPlant: Plant | null;
  season: "all" | "permanent" | "2026" | "2027";
  zoom: number;
  canUndo: boolean;
  canClear: boolean;
  onSeason: (season: "all" | "permanent" | "2026" | "2027") => void;
  onZoom: (zoom: number) => void;
  onUndo: () => void;
  onClear: () => void;
  onSelect: (id: string | null) => void;
  onSelectPlanting: (id: string | null) => void;
  onChange: (object: PlanObject) => void;
  onMovePlanting: (id: string, x: number, y: number) => void;
  onPlace: (x: number, y: number) => void;
  onCancelPlacement: () => void;
  onUpdatePlantingQuantity: (id: string, quantity: number) => void;
  onRemovePlanting: (id: string) => void;
  onOpenPlants: () => void;
  onAdd: (type: PlanObjectType) => void;
  onDelete: () => void;
}) {
  const quickObjects: PlanObjectType[] = ["bed", "flowerbed", "tree", "shrub", "greenhouse", "lawn", "path", "building"];
  const linkedPlantings = selectedObject
    ? plantings.filter((planting) => planting.planObjectId === selectedObject.id)
    : [];
  const selectedZone = selectedPlanting
    ? objects.find((object) => object.id === selectedPlanting.planObjectId)?.label ??
      selectedPlant?.zone ??
      "Участок"
    : null;
  return (
    <>
      <section className="page-title-row">
        <div><p className="eyebrow">Участок 8,4 сотки</p><h1>План сада</h1><p className="lead">Перетаскивайте объекты, меняйте размеры и планируйте посадки по сезонам.</p></div>
        <div className="plan-controls">
          <button className="icon-button" disabled={!canUndo} onClick={onUndo} aria-label="Отменить">↶</button>
          <div className="zoom-control"><button onClick={() => onZoom(Math.max(0.7, zoom - 0.1))}>−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => onZoom(Math.min(1.4, zoom + 0.1))}>+</button></div>
          <button className="clear-plan-button" disabled={!canClear} onClick={onClear}>Очистить план</button>
        </div>
      </section>

      {pendingPlant && (
        <section className="placement-banner" role="status">
          <div className="placement-symbol">+</div>
          <div>
            <p className="eyebrow">Размещение растения</p>
            <strong>{pendingPlant.name}</strong>
            <span>{placementHintForPlant(pendingPlant)}</span>
          </div>
          <button className="soft-button" onClick={onCancelPlacement}>Отменить</button>
        </section>
      )}

      <section className={`plan-workspace ${pendingPlant ? "is-placing" : ""}`}>
        <div className="object-palette">
          <div className="palette-head"><strong>Добавить на план</strong><small>1 клетка = 1 метр</small></div>
          <div className="palette-grid">
            {quickObjects.map((type) => (
              <button key={type} disabled={Boolean(pendingPlant)} onClick={() => onAdd(type)}>
                <span className={`object-swatch swatch-${type}`} />
                {OBJECT_LABELS[type]}
              </button>
            ))}
          </div>
          <div className="layer-switch">
            <span>Слой</span>
            <select value={season} onChange={(event) => onSeason(event.target.value as typeof season)} aria-label="Сезонный слой">
              <option value="all">Все слои</option>
              <option value="permanent">Постоянный</option>
              <option value="2026">Сезон 2026</option>
              <option value="2027">План 2027</option>
            </select>
          </div>
        </div>

        <div className="canvas-column">
          <div className="canvas-toolbar">
            <span><i className="online-dot" /> Автосохранение</span>
            <span>{pendingPlant ? "Нажмите на подходящее место" : `${plantings.length} посадок на плане`}</span>
          </div>
          <GardenCanvas
            objects={objects}
            plantings={plantings}
            plants={plants}
            selectedId={selectedObjectId}
            selectedPlantingId={selectedPlanting?.id ?? null}
            placementPlant={pendingPlant}
            zoom={zoom}
            onSelect={onSelect}
            onSelectPlanting={onSelectPlanting}
            onChange={onChange}
            onMovePlanting={onMovePlanting}
            onPlace={onPlace}
          />
        </div>

        <aside className="object-inspector">
          {selectedPlanting && selectedPlant ? (
            <>
              <div className="inspector-head planting-inspector-head">
                <span className={`planting-dot kind-${selectedPlant.kind.toLowerCase()}`} />
                <div><small>{selectedPlant.kind} · посадка</small><strong>{selectedPlant.name}</strong></div>
              </div>
              <div className="placement-status"><StatusPill tone="green">на плане</StatusPill><span>{selectedZone}</span></div>
              <label>
                Количество
                <input
                  type="number"
                  min="1"
                  max="999"
                  value={selectedPlanting.quantity}
                  onChange={(event) =>
                    onUpdatePlantingQuantity(
                      selectedPlanting.id,
                      Number(event.target.value),
                    )
                  }
                />
              </label>
              <div className="inspector-note">
                <strong>Посадка связана с календарём</strong>
                <p>Задачи и журнал ведутся для этого растения и выбранного места.</p>
              </div>
              <div className="inspector-actions">
                <button className="soft-button" onClick={onOpenPlants}>Карточка растения</button>
                <button className="danger-link" onClick={() => onRemovePlanting(selectedPlanting.id)}>Убрать с плана</button>
              </div>
            </>
          ) : selectedObject ? (
            <>
              <div className="inspector-head"><span className={`object-swatch swatch-${selectedObject.type}`} /><div><small>{OBJECT_LABELS[selectedObject.type]}</small><strong>{selectedObject.label}</strong></div></div>
              <label>Название<input value={selectedObject.label} onChange={(event) => onChange({ ...selectedObject, label: event.target.value })} /></label>
              <div className="field-row">
                <label>Ширина, м<input type="number" min="1" value={(selectedObject.width / 20).toFixed(1)} onChange={(event) => onChange({ ...selectedObject, width: Number(event.target.value) * 20 })} /></label>
                <label>Длина, м<input type="number" min="1" value={(selectedObject.height / 20).toFixed(1)} onChange={(event) => onChange({ ...selectedObject, height: Number(event.target.value) * 20 })} /></label>
              </div>
              <label>Сезон<select value={selectedObject.season} onChange={(event) => onChange({ ...selectedObject, season: event.target.value as PlanObject["season"] })}><option value="permanent">Постоянный</option><option value="2026">2026</option><option value="2027">2027</option></select></label>
              <div className="inspector-note"><strong>Условия зоны</strong><p>Освещение и почву можно уточнить после размещения растений.</p></div>
              {linkedPlantings.length > 0 && (
                <div className="linked-plantings">
                  <strong>Посадки в зоне</strong>
                  {linkedPlantings.map((planting) => {
                    const plant = plants.find((item) => item.id === planting.plantId);
                    return plant ? (
                      <button key={planting.id} onClick={() => onSelectPlanting(planting.id)}>
                        <span>{plant.name}</span><small>{plantCountLabel(planting.quantity)}</small>
                      </button>
                    ) : null;
                  })}
                </div>
              )}
              <button className="danger-link" onClick={onDelete}>Удалить с плана</button>
            </>
          ) : (
            <div className="inspector-empty"><span>↖</span><strong>Выберите объект или посадку</strong><p>Здесь появятся место, количество и связанные действия.</p></div>
          )}
        </aside>
      </section>
    </>
  );
}

function PlantsView({
  gardenPlants,
  plantings,
  catalog,
  query,
  filter,
  onQuery,
  onFilter,
  onAdd,
  onPlace,
  onLocate,
}: {
  gardenPlants: Plant[];
  plantings: Planting[];
  catalog: Plant[];
  query: string;
  filter: "Все" | PlantKind;
  onQuery: (query: string) => void;
  onFilter: (filter: "Все" | PlantKind) => void;
  onAdd: (plant: Plant) => void;
  onPlace: (plantId: string) => void;
  onLocate: (plantId: string) => void;
}) {
  const placedCount = new Set(plantings.map((planting) => planting.plantId)).size;
  return (
    <>
      <section className="page-title-row"><div><p className="eyebrow">Каталог и посадки</p><h1>Растения сада</h1><p className="lead">Добавьте растение, укажите место на плане и получите связанные задачи ухода.</p></div><StatusPill tone="green">{placedCount} из {gardenPlants.length} размещено</StatusPill></section>
      <section className="my-plants-strip">
        {gardenPlants.map((plant) => {
          const placements = plantings.filter(
            (planting) => planting.plantId === plant.id,
          );
          const isPlaced = placements.length > 0;
          return (
            <article key={plant.id} className={`my-plant-card ${isPlaced ? "" : "needs-placement"}`}>
              <div className={`plant-portrait kind-${plant.kind.toLowerCase()}`}><span>{plant.name.slice(0, 1)}</span></div>
              <div><span className="plant-kind">{plant.kind}</span><h3>{plant.name}</h3><p>{isPlaced ? plant.zone : "Место ещё не выбрано"}</p><small>{plant.countLabel}{placements.length > 1 ? ` · ${placements.length} посадки` : ""}</small></div>
              <div className="plant-card-actions">
                <StatusPill tone={isPlaced ? "green" : "rose"}>{isPlaced ? "на плане" : "не размещено"}</StatusPill>
                <button onClick={() => isPlaced ? onLocate(plant.id) : onPlace(plant.id)}>
                  {isPlaced ? "Показать" : "Разместить"}
                </button>
              </div>
            </article>
          );
        })}
      </section>

      <section className="catalog-section">
        <div className="catalog-head"><div><p className="eyebrow">Добавить растение</p><h2>Каталог alpha</h2></div><div className="catalog-search"><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Название или латинское имя" aria-label="Поиск по каталогу" /></div></div>
        <div className="filter-row">
          {(["Все", "Овощи", "Плодовые", "Декоративные"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => onFilter(item)}>{item}</button>)}
          <span>{catalog.length} найдено</span>
        </div>
        <div className="catalog-grid">
          {catalog.slice(0, 18).map((plant) => (
            <article key={plant.id} className="catalog-card">
              <div className="catalog-art" style={{ "--plant-color": plant.bloomColor ?? (plant.kind === "Овощи" ? "#8eab6f" : "#c19a70") } as React.CSSProperties}><span>{plant.name.slice(0, 2)}</span></div>
              <div className="catalog-copy"><span>{plant.kind}</span><h3>{plant.name}</h3><em>{plant.latinName}</em>{plant.bloomStart && <p>Цветение: {MONTHS[plant.bloomStart - 1]}–{MONTHS[(plant.bloomEnd ?? plant.bloomStart) - 1]}</p>}</div>
              <button title="Добавить и разместить" aria-label={`Добавить и разместить ${plant.name}`} onClick={() => onAdd(plant)}>+</button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function BloomView({
  plants,
  onObservation,
}: {
  plants: Plant[];
  onObservation: (flowering: boolean) => void;
}) {
  const bloomers = plants.filter((plant) => plant.bloomStart && plant.bloomEnd);
  return (
    <>
      <section className="page-title-row"><div><p className="eyebrow">Сезонная картина</p><h1>Календарь цветения</h1><p className="lead">Интервалы рассчитаны для Тверской области и уточняются по вашим наблюдениям.</p></div><div className="confidence-note"><span>≈</span><p><strong>Это диапазон, не точная дата.</strong><br />Погода может сдвинуть его на 1–2 недели.</p></div></section>
      <section className="bloom-board">
        <div className="bloom-summary">
          <div className="bloom-orbit"><span>7</span><small>видов</small></div>
          <div><p className="eyebrow">Сейчас цветут</p><h2>Гортензия и эхинацея</h2><p>Палитра сада становится насыщеннее к началу августа. Следующая заметная смена — во второй половине сентября.</p></div>
          <StatusPill tone="rose">пик сезона</StatusPill>
        </div>
        <div className="timeline-table">
          <div className="timeline-head"><span>Растение</span>{MONTHS.slice(2, 10).map((month) => <span key={month}>{month}</span>)}</div>
          {bloomers.map((plant) => (
            <div className="timeline-row" key={plant.id}>
              <div><i style={{ background: plant.bloomColor }} /><span><strong>{plant.name}</strong><small>{plant.zone}</small></span></div>
              {MONTHS.slice(2, 10).map((_, monthIndex) => {
                const month = monthIndex + 3;
                const active = month >= (plant.bloomStart ?? 99) && month <= (plant.bloomEnd ?? 0);
                return <span key={month} className={active ? "bloom-active" : ""} style={active ? { background: plant.bloomColor } : undefined}>{month === 7 && active ? "сейчас" : ""}</span>;
              })}
            </div>
          ))}
        </div>
      </section>
      <section className="observation-callout"><div className="observation-art"><span /><span /><span /></div><div><p className="eyebrow">Помогите уточнить календарь</p><h3>Гортензия уже раскрыла больше половины соцветий?</h3><p>Одно короткое подтверждение сделает прогноз этого и следующего сезона точнее.</p></div><div className="observation-actions"><button className="primary-button" onClick={() => onObservation(true)}>Да, цветёт</button><button className="soft-button" onClick={() => onObservation(false)}>Пока нет</button></div></section>
    </>
  );
}

function JournalView({ entries, draft, onDraft, onSubmit }: { entries: GardenState["journal"]; draft: string; onDraft: (value: string) => void; onSubmit: (event: FormEvent) => void }) {
  return (
    <>
      <section className="page-title-row"><div><p className="eyebrow">История сада</p><h1>Журнал наблюдений</h1><p className="lead">Короткие заметки помогают календарю учитывать реальную жизнь участка.</p></div></section>
      <div className="journal-layout">
        <form className="journal-compose" onSubmit={onSubmit}><p className="eyebrow">Новая запись</p><h2>Что изменилось в саду?</h2><textarea value={draft} onChange={(event) => onDraft(event.target.value)} placeholder="Например: зацвела гортензия, собрали огурцы…" /><div><button type="button" className="soft-button" disabled title="Добавление фотографий появится позже">Фото — позже</button><button className="primary-button" type="submit">Сохранить</button></div><small>Сейчас журнал сохраняет текстовые наблюдения. Фотографии появятся в следующей версии.</small></form>
        <section className="journal-feed">
          {entries.map((entry, index) => (
            <article key={entry.id}><div className="journal-date"><span>{entry.date}</span><i /></div><div className="journal-entry"><span className="journal-index">0{index + 1}</span><StatusPill tone="sand">{entry.zone}</StatusPill><h3>{entry.title}</h3><p>{entry.note}</p></div></article>
          ))}
        </section>
      </div>
    </>
  );
}

function ClearPlanDialog({
  objectCount,
  plantingCount,
  onCancel,
  onConfirm,
}: {
  objectCount: number;
  plantingCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="drawer-backdrop confirmation-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clear-plan-title"
      >
        <span className="confirmation-symbol">×</span>
        <p className="eyebrow">Очистка участка</p>
        <h2 id="clear-plan-title">Очистить весь план?</h2>
        <p>
          С плана исчезнут {russianCount(objectCount, "объект", "объекта", "объектов")} и {russianCount(plantingCount, "посадка", "посадки", "посадок")}.
          Растения останутся в списке, журнал и выполненные дела сохранятся.
        </p>
        <div className="confirmation-note">
          После очистки план можно сразу восстановить кнопкой отмены ↶.
        </div>
        <div className="confirmation-actions">
          <button className="soft-button" type="button" onClick={onCancel}>Отмена</button>
          <button className="danger-button" type="button" onClick={onConfirm}>Очистить план</button>
        </div>
      </section>
    </div>
  );
}

function LocationPanel({
  currentLocation,
  locationStatus,
  onDetect,
  onSelect,
  onClose,
}: {
  currentLocation: GardenLocation;
  locationStatus: "idle" | "requesting" | "denied" | "unsupported";
  onDetect: () => void;
  onSelect: (location: LocationSearchResult) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LocationSearchResult[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchStatus, setSearchStatus] = useState<
    "idle" | "searching" | "ready" | "empty" | "error"
  >("idle");
  const selected = results.find((result) => result.id === selectedId) ?? null;

  const searchLocations = async (event: FormEvent) => {
    event.preventDefault();
    const value = query.trim();
    if (value.length < 2) {
      setResults([]);
      setSelectedId(null);
      setSearchStatus("empty");
      return;
    }

    setSearchStatus("searching");
    setResults([]);
    setSelectedId(null);
    try {
      const response = await fetch(
        `/api/v1/locations?q=${encodeURIComponent(value)}`,
      );
      const payload = (await response.json().catch(() => ({}))) as {
        results?: LocationSearchResult[];
      };
      if (!response.ok) {
        setResults([]);
        setSearchStatus("error");
        return;
      }
      const nextResults = payload.results ?? [];
      setResults(nextResults);
      setSelectedId(nextResults[0]?.id ?? null);
      setSearchStatus(nextResults.length > 0 ? "ready" : "empty");
    } catch {
      setResults([]);
      setSearchStatus("error");
    }
  };

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="assistant-drawer location-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Местоположение участка"
      >
        <div className="drawer-head">
          <div>
            <span className="location-panel-symbol">⌖</span>
            <div><p className="eyebrow">Погодная точка</p><h2>Где находится участок?</h2></div>
          </div>
          <button onClick={onClose} aria-label="Закрыть">×</button>
        </div>

        <section className="current-location-card">
          <div>
            <p className="eyebrow">Сейчас выбрано</p>
            <h3>{currentLocation.label}</h3>
            <p>{currentLocation.region}</p>
          </div>
          <span>
            {currentLocation.latitude.toFixed(2)}, {currentLocation.longitude.toFixed(2)}
          </span>
        </section>

        <button
          className="location-detect-button"
          type="button"
          onClick={onDetect}
          disabled={locationStatus === "requesting"}
        >
          <span>◎</span>
          <span>
            <strong>{locationStatus === "requesting" ? "Определяем…" : "Определить по устройству"}</strong>
            <small>Подойдёт, если вы сейчас на участке</small>
          </span>
        </button>
        {locationStatus === "denied" && (
          <p className="location-inline-error">Браузер не разрешил доступ к геопозиции. Найдите участок вручную ниже.</p>
        )}
        {locationStatus === "unsupported" && (
          <p className="location-inline-error">Это устройство не умеет определять геопозицию. Используйте ручной поиск.</p>
        )}

        <div className="location-divider"><span>или найдите место</span></div>

        <form className="location-search-form" onSubmit={searchLocations}>
          <label htmlFor="garden-location-query">Город, посёлок или деревня</label>
          <div>
            <input
              id="garden-location-query"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Например, Завидово или Клин"
              autoComplete="off"
            />
            <button className="primary-button" type="submit" disabled={searchStatus === "searching"}>
              {searchStatus === "searching" ? "Ищем…" : "Найти"}
            </button>
          </div>
          <small>В пилоте доступны Московская и Тверская области.</small>
        </form>

        {searchStatus === "empty" && (
          <p className="location-search-message">Ничего не нашли. Уточните название или добавьте название области.</p>
        )}
        {searchStatus === "error" && (
          <p className="location-search-message error">Поиск сейчас недоступен. Можно определить место по устройству.</p>
        )}

        {results.length > 0 && (
          <div className="location-results" role="listbox" aria-label="Найденные места">
            {results.map((result) => (
              <button
                key={result.id}
                type="button"
                className={selectedId === result.id ? "selected" : ""}
                onClick={() => setSelectedId(result.id)}
                role="option"
                aria-selected={selectedId === result.id}
              >
                <span className="location-result-marker" />
                <span>
                  <strong>{result.name}</strong>
                  <small>{[result.area, result.region].filter(Boolean).join(" · ")}</small>
                </span>
                <em>{result.latitude.toFixed(2)}, {result.longitude.toFixed(2)}</em>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <button
            className="primary-button location-save-button"
            type="button"
            onClick={() => onSelect(selected)}
          >
            Выбрать {selected.name}
          </button>
        )}

        <p className="location-privacy">
          Сохраняется округлённая точка с точностью примерно до 5 км — без адреса участка. Для ручного поиска название места передаётся GeoNames через Open-Meteo.
        </p>
      </aside>
    </div>
  );
}

function AccountPanel({
  userName,
  userEmail,
  isPreview,
  emailDeliveryEnabled,
  onClose,
}: {
  userName: string;
  userEmail: string | null;
  isPreview: boolean;
  emailDeliveryEnabled: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  const requestLink = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    setMessage("");
    try {
      const response = await fetch("/api/v1/auth/request-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        developmentMagicLink?: string;
      };
      if (response.ok) {
        if (payload.developmentMagicLink) {
          window.location.assign(payload.developmentMagicLink);
          return;
        }
        setStatus("sent");
        setMessage("Проверьте почту. Ссылка действует 15 минут и открывает сад без пароля.");
        return;
      }
      setStatus("error");
      setMessage(
        payload.error === "invalid_email"
          ? "Проверьте написание email."
          : payload.error === "rate_limited"
            ? "Слишком много запросов. Попробуйте через 15 минут."
            : payload.error === "email_unavailable"
              ? "Почтовая доставка ещё не подключена. Демо остаётся доступно без входа."
              : payload.error === "manual_invite_required"
                ? "Вход доступен по персональной ссылке от организатора пилота."
              : "Вход сейчас недоступен. Попробуйте чуть позже.",
      );
    } catch {
      setStatus("error");
      setMessage("Нет связи с сервером. Демо продолжает работать локально.");
    }
  };

  const signOut = async () => {
    await fetch("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/");
  };

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="assistant-drawer account-drawer" role="dialog" aria-modal="true" aria-label="Аккаунт">
        <div className="drawer-head">
          <div>
            <span className="account-symbol">{userName.slice(0, 1).toUpperCase()}</span>
            <div><p className="eyebrow">Личный сад</p><h2>{isPreview ? emailDeliveryEnabled ? "Войти без пароля" : "Войти по приглашению" : userName}</h2></div>
          </div>
          <button onClick={onClose} aria-label="Закрыть">×</button>
        </div>

        {isPreview && emailDeliveryEnabled ? (
          <>
            <section className="account-intro">
              <h3>Сохраните сад между устройствами</h3>
              <p>Пришлём одноразовую ссылку на email. Пароль создавать не нужно.</p>
            </section>
            <form className="auth-form" onSubmit={requestLink}>
              <label htmlFor="account-email">Email</label>
              <input
                id="account-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="sadovod@example.ru"
              />
              <button className="primary-button" type="submit" disabled={status === "sending"}>
                {status === "sending" ? "Отправляем…" : "Получить ссылку для входа"}
              </button>
            </form>
            {message && <p className={`auth-message ${status}`}>{message}</p>}
            <p className="auth-privacy">Точные координаты не сохраняются: погодная точка округляется примерно до 5 км.</p>
          </>
        ) : isPreview ? (
          <>
            <section className="account-intro manual-invite-card">
              <span className="manual-link-symbol">↗</span>
              <div>
                <h3>Получите персональную ссылку</h3>
                <p>Организатор пилота создаёт одноразовую ссылку и отправляет её вам лично. Email и пароль вводить не нужно.</p>
              </div>
            </section>
            <div className="manual-invite-steps">
              <p><span>1</span> Сообщите организатору email, на который будет записан сад.</p>
              <p><span>2</span> Откройте полученную ссылку в этом браузере в течение 15 минут.</p>
            </div>
            <p className="auth-privacy">Ссылка работает один раз. После входа защищённая сессия сохранится на 30 дней.</p>
          </>
        ) : (
          <>
            <section className="account-intro signed-in-card">
              <span className="online-dot" />
              <div><strong>Синхронизация включена</strong><p>{userEmail}</p></div>
            </section>
            <p className="auth-privacy">Сессия хранится в защищённой cookie и действует 30 дней. Выйти можно на этом устройстве в любой момент.</p>
            <button className="soft-button sign-out-button" onClick={signOut}>Выйти из аккаунта</button>
          </>
        )}
      </aside>
    </div>
  );
}

function AssistantPanel({
  state,
  isPreview,
  onClose,
  onAsk,
}: {
  state: GardenState;
  isPreview: boolean;
  onClose: () => void;
  onAsk: (question: string) => Promise<void>;
}) {
  const [question, setQuestion] = useState("");
  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="assistant-drawer" role="dialog" aria-modal="true" aria-label="Советник сада">
        <div className="drawer-head"><div><span className="spark">✦</span><div><p className="eyebrow">Серверный анализ</p><h2>Советник сада</h2></div></div><button onClick={onClose} aria-label="Закрыть">×</button></div>
        <div className="analysis-status"><span className="analysis-pulse" /><div><strong>Последний анализ: {state.lastAnalyzedAt}</strong><p>Проверено {state.plants.length} растений, {state.planObjects.length} объектов и {state.tasks.length} правил ухода.</p></div></div>
        <section className="analysis-card"><p className="eyebrow">Главное наблюдение</p><h3>В теплице три задачи лучше выполнить вместе</h3><p>Полив, сбор огурцов и осмотр томатов относятся к одной зоне. Сначала соберите урожай, затем осмотрите листья и полейте почву, не смачивая зелень.</p><div className="analysis-source"><span>Основано на 3 проверенных правилах</span><StatusPill tone="green">безопасный совет</StatusPill></div></section>
        <section className="privacy-card"><strong>AI видит только обезличенный контекст</strong><p>Названия растений, условия зон и статусы задач. Email, точные координаты, заметки и фотографии исключены.</p>{isPreview && <small>В публичной демоверсии отправка вопросов отключена.</small>}</section>
        <form onSubmit={(event) => { event.preventDefault(); const value = question.trim(); if (!value) return; void onAsk(value); setQuestion(""); }} className="question-box"><label htmlFor="garden-question">Задать вопрос по текущему плану</label><textarea id="garden-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Почему сегодня нужно полить теплицу?" /><div><small>{isPreview ? "Доступно в закрытом пилоте" : "Сложный вопрос обрабатывается в очереди"}</small><button className="primary-button" type="submit">{isPreview ? "Проверить доступ" : "Отправить"}</button></div></form>
      </aside>
    </div>
  );
}
