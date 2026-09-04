import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { translate } from "../../i18n/i18n";
import { displayNameOf, parseScrapMentions, scrapMentionToken, type ScrapRef } from "./scrap-mention";

// "#" 뒤 캐럿까지의 검색어. 단어 경계에서 시작한 것만 트리거로 본다.
const TRIGGER = /(?:^|\s)#([^\s#@]*)$/;
const MAX_SUGGESTIONS = 8;
const ZW = "​";

type Props = {
  value: string;
  onChange: (value: string) => void;
  scraps: ScrapRef[];
  maxLength: number;
  multiline?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
  id?: string;
  onNavigateMention?: (scrapId: string) => void;
};

type Trigger = { query: string; top: number; left: number };

function makeChip(id: string, label: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = "scrap-mention";
  chip.contentEditable = "false";
  chip.dataset.scrapId = id;
  chip.textContent = `#${label}`;
  return chip;
}

function renderInto(host: HTMLElement, value: string, scraps: ScrapRef[]) {
  host.textContent = "";
  for (const segment of parseScrapMentions(value)) {
    if (segment.type === "text") host.append(document.createTextNode(segment.text));
    else host.append(makeChip(segment.id, displayNameOf(segment.id, scraps)));
  }
  // 캐럿이 마지막 칩 뒤에 설 자리를 보장한다.
  if (host.lastChild && (host.lastChild as HTMLElement).dataset?.scrapId) {
    host.append(document.createTextNode(ZW));
  }
}

// contentEditable="plaintext-only" 이라 자식은 텍스트 노드 + 우리 칩 span + 가끔 <br> 뿐이다.
function serialize(host: HTMLElement): string {
  let out = "";
  for (const node of Array.from(host.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) out += (node.textContent ?? "").split(ZW).join("");
    else if (node instanceof HTMLElement) {
      if (node.dataset.scrapId) out += scrapMentionToken(node.dataset.scrapId);
      else if (node.tagName === "BR") out += "\n";
      else out += (node.textContent ?? "").split(ZW).join("");
    }
  }
  return out;
}

export function ScrapMentionInput({
  value, onChange, scraps, maxLength, multiline = false, placeholder, autoFocus, ariaLabel, id, onNavigateMention,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const lastValueRef = useRef<string | null>(null);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const suggestions = trigger
    ? scraps
        .filter((scrap) => (scrap.title.trim() || translate("todo.mention.untitled")).toLowerCase().includes(trigger.query.toLowerCase()))
        .slice(0, MAX_SUGGESTIONS)
    : [];

  // 편집 중이 아닐 때만 DOM을 value/scraps 로 다시 그린다(타이핑을 깨지 않는다).
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || document.activeElement === host) return;
    lastValueRef.current = value;
    renderInto(host, value, scraps);
  }, [value, scraps]);

  useEffect(() => {
    if (!autoFocus) return;
    const host = hostRef.current;
    if (!host) return;
    host.focus();
    placeCaretAtEnd(host);
  }, [autoFocus]);

  function flush() {
    const host = hostRef.current;
    if (!host) return;
    let next = serialize(host);
    if (!multiline) next = next.replace(/\n/g, " ");
    if (next.length > maxLength) {
      // 초과분은 통째로 되돌린다. 토큰이 잘리는 것보다 안전하다.
      renderInto(host, lastValueRef.current ?? "", scraps);
      placeCaretAtEnd(host);
      return;
    }
    lastValueRef.current = next;
    onChange(next);
  }

  function detectTrigger() {
    const host = hostRef.current;
    const selection = window.getSelection();
    if (!host || !selection || selection.rangeCount === 0 || !selection.isCollapsed) {
      setTrigger(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!host.contains(range.startContainer)) {
      setTrigger(null);
      return;
    }
    const match = textBeforeCaret(host, range).match(TRIGGER);
    if (!match) {
      setTrigger(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setTrigger({ query: match[1], top: rect.bottom || rect.top, left: rect.left });
    setActiveIndex(0);
  }

  function commit(scrap: ScrapRef) {
    const host = hostRef.current;
    const selection = window.getSelection();
    if (!host || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const hashAt = (node.textContent ?? "").slice(0, range.startOffset).lastIndexOf("#");
    if (hashAt < 0) return;

    const target = document.createRange();
    target.setStart(node, hashAt);
    target.setEnd(node, range.startOffset);
    target.deleteContents();
    const tail = document.createTextNode(" ");
    target.insertNode(tail);
    target.insertNode(makeChip(scrap.id, scrap.title.trim() || translate("todo.mention.untitled")));

    const after = document.createRange();
    after.setStartAfter(tail);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);

    setTrigger(null);
    flush();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    if (trigger && suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        commit(suggestions[activeIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setTrigger(null);
        return;
      }
    }
    if (!multiline && event.key === "Enter") event.preventDefault();
  }

  return (
    <>
      <div
        aria-label={ariaLabel}
        aria-multiline={multiline || undefined}
        className={`scrap-mention-input${multiline ? " scrap-mention-input--multiline" : ""}`}
        contentEditable="plaintext-only"
        data-placeholder={placeholder}
        id={id}
        onBlur={() => window.setTimeout(() => setTrigger(null), 120)}
        onCompositionEnd={() => { composingRef.current = false; flush(); detectTrigger(); }}
        onCompositionStart={() => { composingRef.current = true; }}
        onClick={(event) => {
          const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-scrap-id]");
          if (chip?.dataset.scrapId) onNavigateMention?.(chip.dataset.scrapId);
        }}
        onInput={() => { if (!composingRef.current) { flush(); detectTrigger(); } }}
        onKeyDown={onKeyDown}
        ref={hostRef}
        role="textbox"
        spellCheck={false}
        suppressContentEditableWarning
      />
      {trigger && suggestions.length > 0 && createPortal(
        <ul className="scrap-mention-menu" role="listbox" style={{ position: "fixed", top: trigger.top + 4, left: trigger.left }}>
          {suggestions.map((scrap, index) => (
            <li
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "scrap-mention-menu__item scrap-mention-menu__item--active" : "scrap-mention-menu__item"}
              key={scrap.id}
              onMouseDown={(event) => { event.preventDefault(); commit(scrap); }}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
            >
              #{scrap.title.trim() || translate("todo.mention.untitled")}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  );
}

function textBeforeCaret(host: HTMLElement, range: Range): string {
  const probe = document.createRange();
  probe.selectNodeContents(host);
  probe.setEnd(range.startContainer, range.startOffset);
  return probe.toString();
}

function placeCaretAtEnd(host: HTMLElement) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(host);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}
