"use client";

import { useState } from "react";
import { buttonClass } from "./ui";

export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass("secondary", "shrink-0")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          /* sem permissão de área de transferência */
        }
      }}
    >
      {done ? "Copiado!" : label}
    </button>
  );
}
