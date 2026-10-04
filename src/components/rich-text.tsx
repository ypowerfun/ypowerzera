import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i} className="text-ink">{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>));
}

/** Renderiza texto simples com listas ("- ") e **negrito**. Tudo é escapado pelo React (sem HTML bruto). */
export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={`l${blocks.length}`} className="list-disc space-y-1.5 pl-5">
          {list.map((l, i) => <li key={i}>{inline(l)}</li>)}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("- ")) list.push(line.slice(2));
    else {
      flush();
      if (line.trim()) blocks.push(<p key={`p${blocks.length}`}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className="space-y-3 text-sm leading-relaxed text-muted">{blocks}</div>;
}
