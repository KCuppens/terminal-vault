import type { SearchAddon } from "@xterm/addon-search";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { SEARCH_DECORATIONS } from "../lib/theme";
import { Icon } from "./ui";

interface Results {
  index: number;
  count: number;
}

export function SearchBar({ addon, onClose }: { addon: SearchAddon; onClose(): void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const sub = addon.onDidChangeResults(({ resultIndex, resultCount }) =>
      setResults({ index: resultIndex, count: resultCount }),
    );
    return () => {
      sub.dispose();
      addon.clearDecorations();
    };
  }, [addon]);

  function search(next: string, direction: "next" | "previous", incremental = false) {
    if (next === "") {
      addon.clearDecorations();
      setResults(null);
      return;
    }
    const options = { decorations: SEARCH_DECORATIONS, incremental };
    if (direction === "next") addon.findNext(next, options);
    else addon.findPrevious(next, options);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      search(query, e.shiftKey ? "previous" : "next");
    }
  }

  let summary = "";
  if (query !== "" && results) {
    if (results.count === 0) summary = "No results";
    else if (results.index < 0) summary = `${results.count}+`;
    else summary = `${results.index + 1}/${results.count}`;
  }

  return (
    <div className="search-bar" role="search">
      <Icon name="search" size={14} />
      <input
        ref={inputRef}
        className="search-input"
        value={query}
        placeholder="Search scrollback"
        aria-label="Search scrollback"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value);
          search(e.target.value, "next", true);
        }}
        onKeyDown={onKeyDown}
      />
      <span className="search-count" aria-live="polite">
        {summary}
      </span>
      <button type="button" className="icon-btn" aria-label="Previous match" onClick={() => search(query, "previous")}>
        <Icon name="arrowUp" size={14} />
      </button>
      <button type="button" className="icon-btn" aria-label="Next match" onClick={() => search(query, "next")}>
        <Icon name="arrowDown" size={14} />
      </button>
      <button type="button" className="icon-btn" aria-label="Close search" onClick={onClose}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
