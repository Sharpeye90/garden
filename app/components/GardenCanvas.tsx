"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  Ellipse,
  Group,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
  Transformer,
} from "react-konva";
import type Konva from "konva";
import type { Plant, Planting, PlanObject } from "../types";
import { snap } from "../lib/domain";

type GardenCanvasProps = {
  objects: PlanObject[];
  plantings: Planting[];
  plants: Plant[];
  selectedId: string | null;
  selectedPlantingId: string | null;
  placementPlant: Plant | null;
  zoom: number;
  onSelect: (id: string | null) => void;
  onSelectPlanting: (id: string | null) => void;
  onChange: (object: PlanObject) => void;
  onMovePlanting: (id: string, x: number, y: number) => void;
  onPlace: (x: number, y: number) => void;
};

const BASE_WIDTH = 820;
const BASE_HEIGHT = 540;

function EditableObject({
  object,
  selected,
  interactive,
  onSelect,
  onChange,
}: {
  object: PlanObject;
  selected: boolean;
  interactive: boolean;
  onSelect: () => void;
  onChange: (object: PlanObject) => void;
}) {
  const shapeRef = useRef<Konva.Shape>(null);
  const transformerRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (selected && shapeRef.current && transformerRef.current) {
      transformerRef.current.nodes([shapeRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [selected]);

  const isRound = object.type === "tree" || object.type === "shrub";
  const isEllipse = object.type === "pond" || object.type === "flowerbed";
  const shared = {
    x: object.x,
    y: object.y,
    rotation: object.rotation,
    fill: object.color,
    stroke: selected ? "#345a43" : "rgba(55, 77, 59, 0.28)",
    strokeWidth: selected ? 2 : 1,
    shadowColor: "rgba(31, 46, 35, 0.16)",
    shadowBlur: selected ? 10 : 4,
    shadowOffsetY: 2,
    cornerRadius: object.type === "greenhouse" ? 18 : 8,
    draggable: interactive,
    listening: interactive,
    onClick: onSelect,
    onTap: onSelect,
    onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => {
      onChange({
        ...object,
        x: snap(event.target.x()),
        y: snap(event.target.y()),
      });
    },
    onTransformEnd: () => {
      const node = shapeRef.current;
      if (!node) return;
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      node.scaleX(1);
      node.scaleY(1);
      const baseWidth = "width" in node ? Number(node.width()) : object.width;
      const baseHeight = "height" in node ? Number(node.height()) : object.height;
      onChange({
        ...object,
        x: snap(node.x()),
        y: snap(node.y()),
        width: Math.max(24, snap(baseWidth * scaleX)),
        height: Math.max(24, snap(baseHeight * scaleY)),
        rotation: Math.round(node.rotation()),
      });
    },
  };

  return (
    <>
      <Group>
        {isRound ? (
          <Circle
            {...shared}
            ref={(node) => {
              shapeRef.current = node;
            }}
            radius={Math.max(object.width, object.height) / 2}
            x={object.x + object.width / 2}
            y={object.y + object.height / 2}
          />
        ) : isEllipse ? (
          <Ellipse
            {...shared}
            ref={(node) => {
              shapeRef.current = node;
            }}
            radiusX={object.width / 2}
            radiusY={object.height / 2}
            x={object.x + object.width / 2}
            y={object.y + object.height / 2}
          />
        ) : (
          <Rect
            {...shared}
            ref={(node) => {
              shapeRef.current = node;
            }}
            width={object.width}
            height={object.height}
          />
        )}
        <Text
          x={object.x + 7}
          y={object.y + Math.max(6, object.height / 2 - 7)}
          width={Math.max(40, object.width - 14)}
          text={object.label}
          fontSize={object.width < 70 ? 9 : 11}
          fontFamily="Arial"
          fill="#294032"
          align="center"
          listening={false}
          ellipsis
          wrap="none"
        />
      </Group>
      {selected && (
        <Transformer
          ref={transformerRef}
          rotateEnabled
          borderStroke="#345a43"
          anchorStroke="#345a43"
          anchorFill="#f8f6ee"
          anchorSize={9}
          padding={4}
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < 24 || newBox.height < 24 ? oldBox : newBox
          }
        />
      )}
    </>
  );
}

function PlantingMarker({
  planting,
  plant,
  selected,
  interactive,
  onSelect,
  onMove,
}: {
  planting: Planting;
  plant: Plant;
  selected: boolean;
  interactive: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
}) {
  const color =
    plant.bloomColor ??
    (plant.kind === "Овощи"
      ? "#71985f"
      : plant.kind === "Плодовые"
        ? "#587d4e"
        : "#b87591");
  const label = planting.quantity > 1 ? `${plant.name} · ${planting.quantity}` : plant.name;

  return (
    <Group
      x={planting.x}
      y={planting.y}
      draggable={interactive}
      listening={interactive}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(event) => onMove(snap(event.target.x()), snap(event.target.y()))}
    >
      <Circle
        radius={selected ? 13 : 11}
        fill={color}
        stroke={selected ? "#244b35" : "#fffdf6"}
        strokeWidth={selected ? 3 : 2}
        shadowColor="rgba(31, 46, 35, 0.2)"
        shadowBlur={selected ? 10 : 4}
      />
      <Text
        x={16}
        y={-8}
        width={118}
        text={label}
        fontSize={10}
        fontFamily="Arial"
        fontStyle={selected ? "bold" : "normal"}
        fill="#294032"
        padding={2}
        listening={false}
      />
    </Group>
  );
}

export default function GardenCanvas({
  objects,
  plantings,
  plants,
  selectedId,
  selectedPlantingId,
  placementPlant,
  zoom,
  onSelect,
  onSelectPlanting,
  onChange,
  onMovePlanting,
  onPlace,
}: GardenCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [wrapperWidth, setWrapperWidth] = useState(BASE_WIDTH);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setWrapperWidth(Math.max(300, entry.contentRect.width));
    });
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, []);

  const fit = Math.min(1, (wrapperWidth - 2) / BASE_WIDTH);
  const scale = fit * zoom;
  const handlePointer = (
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) => {
    const stage = event.target.getStage();
    if (!stage) return;
    if (placementPlant) {
      const pointer = stage.getPointerPosition();
      if (pointer) onPlace(pointer.x / scale, pointer.y / scale);
      return;
    }
    if (event.target === stage) {
      onSelect(null);
      onSelectPlanting(null);
    }
  };
  const grid = useMemo(() => {
    const lines = [];
    for (let x = 20; x < BASE_WIDTH; x += 20) {
      lines.push(
        <Line
          key={`x-${x}`}
          points={[x, 0, x, BASE_HEIGHT]}
          stroke={x % 100 === 0 ? "#d4d7c7" : "#e5e6dc"}
          strokeWidth={x % 100 === 0 ? 1 : 0.5}
          listening={false}
        />,
      );
    }
    for (let y = 20; y < BASE_HEIGHT; y += 20) {
      lines.push(
        <Line
          key={`y-${y}`}
          points={[0, y, BASE_WIDTH, y]}
          stroke={y % 100 === 0 ? "#d4d7c7" : "#e5e6dc"}
          strokeWidth={y % 100 === 0 ? 1 : 0.5}
          listening={false}
        />,
      );
    }
    return lines;
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="garden-canvas-wrap"
      data-testid="garden-canvas"
      data-placing={placementPlant ? "true" : "false"}
    >
      <Stage
        width={Math.max(wrapperWidth, BASE_WIDTH * scale)}
        height={BASE_HEIGHT * scale}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={handlePointer}
        onTouchStart={handlePointer}
      >
        <Layer>
          <Rect
            x={0}
            y={0}
            width={BASE_WIDTH}
            height={BASE_HEIGHT}
            fill="#f8f7f0"
            listening={false}
          />
          {grid}
          <Rect
            x={42}
            y={36}
            width={700}
            height={470}
            stroke="#80917f"
            strokeWidth={2}
            dash={[8, 6]}
            cornerRadius={2}
            listening={false}
          />
          <Text
            x={48}
            y={12}
            text="35 м"
            fontSize={11}
            fill="#7b857b"
            listening={false}
          />
          <Text
            x={754}
            y={230}
            text="24 м"
            fontSize={11}
            fill="#7b857b"
            rotation={90}
            listening={false}
          />
          {objects.map((object) => (
            <EditableObject
              key={object.id}
              object={object}
              selected={object.id === selectedId}
              interactive={!placementPlant}
              onSelect={() => onSelect(object.id)}
              onChange={onChange}
            />
          ))}
          {plantings.map((planting) => {
            const plant = plants.find((item) => item.id === planting.plantId);
            if (!plant) return null;
            return (
              <PlantingMarker
                key={planting.id}
                planting={planting}
                plant={plant}
                selected={planting.id === selectedPlantingId}
                interactive={!placementPlant}
                onSelect={() => onSelectPlanting(planting.id)}
                onMove={(x, y) => onMovePlanting(planting.id, x, y)}
              />
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
