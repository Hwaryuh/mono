import type { DashboardSnapshot } from "@mono/contracts";
import type { PlatformModuleId } from "@mono/domain";
import { Button, Icon, Input, SectionHeader, type IconName } from "@mono/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { Link } from "react-router";
import { useMediaStore } from "../../infrastructure/media/media-store-context";
import type { DashboardRepository } from "./dashboard-repository";

// 편집 중에는 원본(data URL)을 메모리에만 들고, 제출 시 media 저장소에 저장하고 mediaId만 넘긴다.
type PendingMedia = { name: string; mimeType: string; size: number; dataUrl: string };

const moduleMeta: Record<PlatformModuleId, { name: string; color: string; icon: IconName }> = {
  todo: { name: "할 일", color: "oklch(0.539 0.082 160.129)", icon: "todo" },
  routine: { name: "루틴", color: "oklch(0.564 0.129 37.329)", icon: "routine" },
  calendar: { name: "일정", color: "oklch(0.604 0.149 260.322)", icon: "calendar" },
  scrap: { name: "스크랩", color: "oklch(0.502 0.132 309.199)", icon: "scrap" },
  ledger: { name: "가계부", color: "oklch(0.603 0.109 75.876)", icon: "wallet" },
};

export const dashboardQueryKey = ["dashboard"] as const;

interface QuickCaptureProps {
  autoFocus?: boolean;
  repository: DashboardRepository;
  showHeading?: boolean;
  snapshot?: DashboardSnapshot;
}

const maxCaptureImages = 4;
const maxCaptureImageBytes = 10 * 1024 * 1024;
// Gemini inline 요청은 전체 20MB 제한. Base64 팽창과 JSON 프롬프트 여유를 남긴다.
const maxCaptureImageTotalBytes = 13 * 1024 * 1024;
const maxCaptureVideos = 1;
const maxCaptureVideoBytes = 100 * 1024 * 1024;

type DropMode = "text" | "media" | null;

function dropModeOf(dataTransfer: DataTransfer): DropMode {
  const types = Array.from(dataTransfer.types);
  if (types.includes("Files")) return "media";
  if (types.includes("text/uri-list") || types.includes("text/plain")) return "text";
  return null;
}

function droppedTextOf(dataTransfer: DataTransfer) {
  const droppedUrl = dataTransfer.getData("text/uri-list")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  return droppedUrl ?? dataTransfer.getData("text/plain").trim();
}

function captureImageOf(file: File) {
  return new Promise<PendingMedia>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("사진을 읽지 못했습니다."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("사진을 읽지 못했습니다."));
        return;
      }
      resolve({ name: file.name, mimeType: file.type, size: file.size, dataUrl: reader.result });
    };
    reader.readAsDataURL(file);
  });
}

function captureVideoOf(file: File) {
  return new Promise<PendingMedia>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("영상을 읽지 못했습니다."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("영상을 읽지 못했습니다."));
        return;
      }
      resolve({ name: file.name, mimeType: file.type, size: file.size, dataUrl: reader.result });
    };
    reader.readAsDataURL(file);
  });
}

export function formatMediaSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function QuickCapture({ autoFocus = false, repository, showHeading = false, snapshot }: QuickCaptureProps) {
  const [captureText, setCaptureText] = useState("");
  const [captureImages, setCaptureImages] = useState<PendingMedia[]>([]);
  const [captureVideos, setCaptureVideos] = useState<PendingMedia[]>([]);
  const [mediaPending, setMediaPending] = useState(false);
  const [dragMode, setDragMode] = useState<DropMode>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const dragDepthRef = useRef(0);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const mediaStore = useMediaStore();
  const captureMutation = useMutation({
    mutationFn: async (pending: { raw: string; images: PendingMedia[]; videos: PendingMedia[] }) => {
      const persist = async ({ dataUrl, ...meta }: PendingMedia) => {
        const mediaId = crypto.randomUUID();
        await mediaStore.save(mediaId, dataUrl);
        return { ...meta, mediaId };
      };
      // 이미지는 dataUrl을 실어 보낸다 — 서버가 캡처 분석(Gemini)에만 쓰고 영속화하지 않는다.
      const [images, videos] = await Promise.all([
        Promise.all(pending.images.map(async (image) => ({ ...(await persist(image)), dataUrl: image.dataUrl }))),
        Promise.all(pending.videos.map(persist)),
      ]);
      return repository.capture({ raw: pending.raw, images, videos });
    },
    onSuccess: async () => {
      setCaptureText("");
      setCaptureImages([]);
      setCaptureVideos([]);
      setDropError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["inbox"] }),
      ]);
    },
  });

  function submitCapture(event: FormEvent) {
    event.preventDefault();
    const raw = captureText.trim();
    if ((!raw && captureImages.length === 0 && captureVideos.length === 0) || captureMutation.isPending || mediaPending) return;
    setDropError(null);
    captureMutation.reset();
    captureMutation.mutate({ raw, images: captureImages, videos: captureVideos });
  }

  async function addMedia(files: File[]) {
    if (files.length === 0 || mediaPending) return;
    if (files.some((file) => !file.type.startsWith("image/") && !file.type.startsWith("video/"))) {
      setDropError("사진 또는 영상 파일만 첨부할 수 있습니다.");
      return;
    }
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    const videoFiles = files.filter((file) => file.type.startsWith("video/"));
    if (imageFiles.some((file) => file.size > maxCaptureImageBytes)) {
      setDropError("사진 한 장은 10MB를 넘을 수 없습니다.");
      return;
    }
    if ([...captureImages, ...imageFiles].reduce((total, file) => total + file.size, 0) > maxCaptureImageTotalBytes) {
      setDropError("사진 전체 용량은 13MB를 넘을 수 없습니다.");
      return;
    }
    if (videoFiles.some((file) => file.size > maxCaptureVideoBytes)) {
      setDropError("영상은 100MB를 넘을 수 없습니다.");
      return;
    }
    if (captureImages.length + imageFiles.length > maxCaptureImages) {
      setDropError(`사진은 최대 ${maxCaptureImages}장까지 첨부할 수 있습니다.`);
      return;
    }
    if (captureVideos.length + videoFiles.length > maxCaptureVideos) {
      setDropError("영상은 최대 1개까지 첨부할 수 있습니다.");
      return;
    }
    setMediaPending(true);
    setDropError(null);
    captureMutation.reset();
    try {
      const [nextImages, nextVideos] = await Promise.all([
        Promise.all(imageFiles.map(captureImageOf)),
        Promise.all(videoFiles.map(captureVideoOf)),
      ]);
      setCaptureImages((current) => [...current, ...nextImages].slice(0, maxCaptureImages));
      setCaptureVideos((current) => [...current, ...nextVideos].slice(0, maxCaptureVideos));
    } catch {
      setDropError("미디어를 읽지 못했습니다. 다른 파일을 선택해 주세요.");
    } finally {
      setMediaPending(false);
    }
  }

  function enterDropZone(event: DragEvent<HTMLElement>) {
    const nextMode = dropModeOf(event.dataTransfer);
    if (!nextMode) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragMode(nextMode);
  }

  function leaveDropZone(event: DragEvent<HTMLElement>) {
    if (!dropModeOf(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragMode(null);
  }

  function keepDropZoneActive(event: DragEvent<HTMLElement>) {
    const nextMode = dropModeOf(event.dataTransfer);
    if (!nextMode) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragMode(nextMode);
  }

  function dropCapture(event: DragEvent<HTMLElement>) {
    const droppedMode = dropModeOf(event.dataTransfer);
    if (!droppedMode) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragMode(null);
    if (droppedMode === "media") {
      void addMedia(Array.from(event.dataTransfer.files));
      return;
    }
    const droppedText = droppedTextOf(event.dataTransfer);
    if (!droppedText) {
      setDropError("드롭한 항목에서 텍스트나 링크를 찾지 못했습니다.");
      return;
    }
    const nextText = [captureText.trim(), droppedText].filter(Boolean).join(" ");
    if (nextText.length > 2_000) {
      setDropError("텍스트는 2,000자를 넘을 수 없습니다.");
      return;
    }
    setCaptureText(nextText);
    setDropError(null);
    captureMutation.reset();
  }

  return (
    <section
      aria-label="빠른 캡처 드롭 영역"
      className={`quick-capture ${dragMode ? "quick-capture--dragging" : ""}`.trim()}
      onDragEnter={enterDropZone}
      onDragLeave={leaveDropZone}
      onDragOver={keepDropZoneActive}
      onDrop={dropCapture}
    >
      <div aria-hidden="true" className="quick-capture__drop-feedback">
        <Icon name={dragMode === "media" ? "video" : "inbox"} size={18} strokeWidth={1.6} />
        <strong>{dragMode === "media" ? "놓아서 사진 또는 영상 첨부" : "놓아서 입력에 추가"}</strong>
        <span>분석은 화살표 버튼을 눌러 시작합니다</span>
      </div>

      {showHeading && <SectionHeader title={<span className="section-title-with-icon"><Icon name="sparkles" size={15} strokeWidth={1.5} />빠른 캡처</span>} />}
      <form aria-busy={captureMutation.isPending} className="capture-form" onSubmit={submitCapture}>
        <Input
          aria-label="빠른 캡처"
          data-overlay-autofocus={autoFocus ? "true" : undefined}
          maxLength={2_000}
          onChange={(event) => {
            setCaptureText(event.target.value);
            setDropError(null);
            if (captureMutation.isError) captureMutation.reset();
          }}
          placeholder="무엇이든 입력하세요..."
          value={captureText}
        />
        <input
          accept="image/*,video/*"
          aria-label="사진 또는 영상 파일 선택"
          className="capture-file-input"
          multiple
          onChange={(event) => {
            void addMedia(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
          ref={mediaInputRef}
          type="file"
        />
        <Button aria-label="사진 또는 영상 추가" disabled={captureMutation.isPending || mediaPending} onClick={() => mediaInputRef.current?.click()} type="button">
          <Icon name="file" size={15} strokeWidth={1.7} />
        </Button>
        <Button aria-label="분류 요청" loading={captureMutation.isPending} type="submit" variant="primary">
          <Icon name="send" size={15} strokeWidth={2} />
        </Button>
      </form>

      {(captureImages.length > 0 || captureVideos.length > 0 || mediaPending) && (
        <div aria-label="첨부한 미디어" className="capture-images" role="list">
          {captureImages.map((image, index) => (
            <div className="capture-image" key={`${image.name}-${image.size}-${index}`} role="listitem">
              <img alt={image.name} src={image.dataUrl} />
              <span><strong title={image.name}>{image.name}</strong><small>{formatMediaSize(image.size)}</small></span>
              <button
                aria-label={`${image.name} 첨부 제거`}
                onClick={() => setCaptureImages((current) => current.filter((_, imageIndex) => imageIndex !== index))}
                type="button"
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}
          {captureVideos.map((video, index) => (
            <div className="capture-image" key={`${video.name}-${video.size}-${index}`} role="listitem">
              <div aria-label={`${video.name} 영상`} className="capture-video-placeholder" role="img"><Icon name="video" size={16} /></div>
              <span><strong title={video.name}>{video.name}</strong><small>{formatMediaSize(video.size)} · 스크랩으로 분류</small></span>
              <button
                aria-label={`${video.name} 첨부 제거`}
                onClick={() => setCaptureVideos((current) => current.filter((_, videoIndex) => videoIndex !== index))}
                type="button"
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}
          {mediaPending && <span className="capture-image-loading" role="status">미디어를 불러오는 중…</span>}
        </div>
      )}

      {(dropError || captureMutation.isError) && (
        <p className="capture-error" role="alert">{dropError ?? "캡처하지 못했습니다. 잠시 후 다시 시도해 주세요."}</p>
      )}

      {snapshot && (
        <div className="capture-meta">
          <span className="capture-meta__label">최근 분류:</span>
          {snapshot.recentCaptures.slice(0, 2).map((capture) => {
            const meta = moduleMeta[capture.module];
            return (
              <Link className="capture-chip" key={capture.id} to="/inbox">
                <span className="capture-chip__raw">{capture.raw}</span>
                <Icon name="chevronRight" size={10} />
                <Icon name={meta.icon} size={11} style={{ color: meta.color }} />
                <span>{meta.name}</span><span>{Math.round(capture.confidence * 100)}%</span>
              </Link>
            );
          })}
          <Link className="inbox-link" to="/inbox">수집함 {snapshot.pendingCaptureCount}건 대기<Icon name="chevronRight" size={11} /></Link>
        </div>
      )}
    </section>
  );
}
