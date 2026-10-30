import React, { useEffect, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { readFileSync } from "node:fs";

type Sprite = {
  frame_ms: number;
  palette: number[][];
  sprites: Record<string, string[]>;
};
// Original Scabbers skill asset, bundled locally; no Python or media tools.
const sprite: Sprite = JSON.parse(
  readFileSync(new URL("../../assets/mascot.json", import.meta.url), "utf8"),
);
const color = (key: string) => {
  const rgb = sprite.palette[key.charCodeAt(0) - 97]!;
  return (
    "#" + rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")
  );
};

export function MascotFrame({
  frame,
  size = 12,
  ascii = false,
}: {
  frame: number;
  size?: number;
  ascii?: boolean;
}): React.ReactElement {
  if (ascii) {
    const eyes = frame % 12 === 9 ? " ( (- .-) ) " : " ( (o .o) ) ";
    return (
      <Text color="magenta">
        {[
          "     /\\     ",
          "  __/  \\__  ",
          eyes,
          "~ \\  ^  /   ",
          "  /|(o> |   ",
          "   |(__)|   ",
        ].join("\n")}
      </Text>
    );
  }
  const frames = sprite.sprites[String(size)]!;
  const pixels = frames[frame % frames.length]!;
  return (
    <Box flexDirection="column">
      {Array.from({ length: size / 2 }, (_, row) => (
        <Text key={row}>
          {Array.from({ length: size }, (_, col) => {
            const top = pixels[row * 2 * size + col]!;
            const bottom = pixels[(row * 2 + 1) * size + col]!;
            if (top === "." && bottom === ".") return " ";
            const foreground = top === "." ? bottom : top;
            return (
              <Text
                key={col}
                color={color(foreground)}
                {...(top !== "." && bottom !== "."
                  ? { backgroundColor: color(bottom) }
                  : {})}
              >
                {top === "." ? "▄" : "▀"}
              </Text>
            );
          })}
        </Text>
      ))}
    </Box>
  );
}

export function Mascot(): React.ReactElement {
  const [frame, setFrame] = useState(0);
  const { stdout } = useStdout();
  useEffect(() => {
    const timer = setInterval(
      () => setFrame((value) => value + 1),
      sprite.frame_ms,
    );
    return () => clearInterval(timer);
  }, []);
  return (
    <MascotFrame
      frame={frame}
      size={stdout.columns >= 100 && stdout.rows >= 35 ? 24 : 12}
      ascii={process.env.TERM === "dumb"}
    />
  );
}
