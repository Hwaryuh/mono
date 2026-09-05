import { Link } from "react-router";
import { translate } from "../../i18n/i18n";
import { parseScrapMentions, type ScrapRef } from "./scrap-mention";

// Renders scrap-mention tokens embedded in free text. A live scrap becomes a link to its detail view,
// a deleted scrap is shown as inactive. The display name is looked up from the current title on every render.
export function ScrapText({ text, scraps }: { text: string; scraps: ScrapRef[] }) {
  return (
    <>
      {parseScrapMentions(text).map((segment, index) => {
        if (segment.type === "text") return <span key={index}>{segment.text}</span>;
        const scrap = scraps.find((candidate) => candidate.id === segment.id);
        if (!scrap) {
          return <span className="scrap-mention scrap-mention--missing" key={index}>#{translate("todo.mention.missing")}</span>;
        }
        const name = scrap.title.trim() || translate("todo.mention.untitled");
        return (
          <Link
            aria-label={translate("todo.mention.openLabel", { title: name })}
            className="scrap-mention scrap-mention--link"
            key={index}
            onClick={(event) => event.stopPropagation()}
            to={`/scrap?detail=${encodeURIComponent(segment.id)}`}
          >
            #{name}
          </Link>
        );
      })}
    </>
  );
}
