import { Link } from "react-router";
import { translate } from "../../i18n/i18n";
import { parseScrapMentions, type ScrapRef } from "./scrap-mention";

// 자유 텍스트에 섞인 스크랩 멘션 토큰을 렌더한다. 살아 있는 스크랩은 상세로 가는 링크,
// 삭제된 스크랩은 비활성 표시. 표시 이름은 매 렌더 현재 제목에서 조회한다.
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
